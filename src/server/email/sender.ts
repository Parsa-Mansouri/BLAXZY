import { createTransport, type Transporter } from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";
import { getEnv } from "@/server/env";
import { maybeFault } from "@/server/faults";
import { emailFaultError } from "@/server/faults/errors";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain-text body; always sent, and the fallback for clients that do not show HTML. */
  text: string;
  /**
   * Optional HTML version of the same mail. The SMTP transport sends it next to `text` as a
   * multipart/alternative message; it must hold no unescaped user-supplied text.
   */
  html?: string;
  /**
   * The one link the recipient has to follow (verification, password reset). Only the console
   * transport (development) prints it; the SMTP transport sends it inside `text` (and `html`) and never logs it.
   */
  actionUrl?: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development transport: prints the email to the server log. This is the only place where an
 * action link (which contains a token) is logged, so it is never selected in production.
 */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly from: string) {}

  async send(message: EmailMessage): Promise<void> {
    if (maybeFault("email")) throw emailFaultError();
    const rule = "=".repeat(72);
    const lines = [
      "",
      rule,
      "[email] DEV ONLY: console transport, never use in production (links carry tokens)",
      `[email] from:    ${this.from}`,
      `[email] to:      ${message.to}`,
      `[email] subject: ${message.subject}`,
      ...(message.actionUrl ? [`[email] link:    ${message.actionUrl}`] : []),
      rule,
      message.text,
      rule,
      "",
    ];
    console.info(lines.join("\n"));
  }
}

const HEADER_BREAK = /[\r\n\0]/;
/** One bare address: no list separators, brackets, quotes or whitespace. */
const SINGLE_ADDRESS = /^[^\s<>,;"]+@[^\s<>,;"]+$/;

/** Throws when a header value could inject headers or extra recipients. */
function assertSafeHeaders(from: string, message: EmailMessage): void {
  if (HEADER_BREAK.test(from)) throw new Error("Refusing to send: invalid line break in sender");
  if (HEADER_BREAK.test(message.subject)) {
    throw new Error("Refusing to send: invalid line break in subject");
  }
  if (HEADER_BREAK.test(message.to) || !SINGLE_ADDRESS.test(message.to)) {
    throw new Error("Refusing to send: recipient must be one plain address");
  }
}

export type SmtpSettings = {
  from: string;
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** `SMTP_SECURE`: true = implicit TLS from the first byte (usually port 465). */
  secure?: boolean;
  /** Development only: allow a plain-text server on a loopback address (a local mail catcher). */
  allowPlaintextLoopback?: boolean;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Maps the settings to nodemailer options.
 *
 * - `SMTP_SECURE=true`: `secure: true`, TLS from the first byte (port 465 style).
 * - `SMTP_SECURE=false` or unset: `secure: false` plus `requireTLS: true`, so the connection
 *   starts in clear text but must upgrade with STARTTLS (port 587 style) before any credential or
 *   message is sent; a server that cannot do TLS makes the send fail instead of going out in
 *   clear text. The one exception is a loopback host in development (`allowPlaintextLoopback`).
 */
export function buildSmtpOptions(settings: SmtpSettings): SMTPPool.Options {
  const secure = settings.secure === true;
  const plaintextOk =
    !secure && settings.allowPlaintextLoopback === true && LOOPBACK_HOSTS.has(settings.host);
  return {
    pool: true,
    host: settings.host,
    port: settings.port,
    secure,
    requireTLS: !secure && !plaintextOk,
    ignoreTLS: plaintextOk,
    ...(settings.user && settings.password
      ? { auth: { user: settings.user, pass: settings.password } }
      : {}),
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
    tls: { minVersion: "TLSv1.2" },
  };
}

/** Sends mail through SMTP over one pooled transport per process, created on first use. */
export class SmtpEmailSender implements EmailSender {
  private transport: Transporter | undefined;

  /** `transport` is for tests (no network); production code lets the sender create its own. */
  constructor(
    private readonly settings: SmtpSettings,
    transport?: Transporter,
  ) {
    this.transport = transport;
  }

  async send(message: EmailMessage): Promise<void> {
    assertSafeHeaders(this.settings.from, message);
    if (maybeFault("email")) throw emailFaultError();
    this.transport ??= createTransport(buildSmtpOptions(this.settings));
    await this.transport.sendMail({
      from: this.settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }

  /** Closes pooled connections (process shutdown, tests). */
  close(): void {
    this.transport?.close();
    this.transport = undefined;
  }
}

let sender: EmailSender | undefined;

/** Lazily created sender selected by `EMAIL_TRANSPORT`. */
export function getEmailSender(): EmailSender {
  if (!sender) {
    const env = getEnv();
    if (env.EMAIL_TRANSPORT === "smtp") {
      if (!env.SMTP_HOST || !env.SMTP_PORT) {
        throw new Error("EMAIL_TRANSPORT=smtp needs SMTP_HOST and SMTP_PORT");
      }
      sender = new SmtpEmailSender({
        from: env.EMAIL_FROM,
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        secure: env.SMTP_SECURE,
        allowPlaintextLoopback: env.NODE_ENV !== "production",
      });
    } else {
      if (env.NODE_ENV === "production") {
        throw new Error("EMAIL_TRANSPORT=console is not allowed in production; use smtp");
      }
      sender = new ConsoleEmailSender(env.EMAIL_FROM);
    }
  }
  return sender;
}
