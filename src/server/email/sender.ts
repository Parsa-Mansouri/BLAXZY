import { getEnv } from "@/server/env";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /**
   * The one link the recipient has to follow (verification, password reset). The console
   * transport prints it on its own line so a developer can click it.
   */
  actionUrl?: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development transport: prints the email to the server log. This is the only place where an
 * action link (which contains a token) is logged, so never select it in production.
 */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly from: string) {}

  async send(message: EmailMessage): Promise<void> {
    const rule = "=".repeat(72);
    const lines = [
      "",
      rule,
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

/** Placeholder for the real transport; wire an SMTP client here when one is chosen. */
export class SmtpEmailSender implements EmailSender {
  async send(): Promise<void> {
    throw new Error("EMAIL_TRANSPORT=smtp is not implemented yet; use EMAIL_TRANSPORT=console.");
  }
}

let sender: EmailSender | undefined;

/** Lazily created sender selected by `EMAIL_TRANSPORT`. */
export function getEmailSender(): EmailSender {
  if (!sender) {
    const env = getEnv();
    sender =
      env.EMAIL_TRANSPORT === "smtp"
        ? new SmtpEmailSender()
        : new ConsoleEmailSender(env.EMAIL_FROM);
  }
  return sender;
}
