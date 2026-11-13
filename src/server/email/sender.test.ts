import { createTransport } from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSmtpOptions, ConsoleEmailSender, SmtpEmailSender, type EmailMessage } from "./sender";

const settings = { from: "BLAXZY <no-reply@example.com>", host: "smtp.example.com", port: 587 };
const message: EmailMessage = {
  to: "user@example.com",
  subject: "Hello",
  text: "body with https://app.example.com/reset?token=SECRET",
  actionUrl: "https://app.example.com/reset?token=SECRET",
};

function jsonSender() {
  const transport = createTransport({ jsonTransport: true });
  const sendMail = vi.spyOn(transport, "sendMail");
  return { sender: new SmtpEmailSender(settings, transport), sendMail };
}

afterEach(() => vi.restoreAllMocks());

describe("buildSmtpOptions", () => {
  it("requires STARTTLS unless SMTP_SECURE=true, and uses implicit TLS then", () => {
    expect(buildSmtpOptions(settings)).toMatchObject({
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
    });
    expect(buildSmtpOptions({ ...settings, port: 465, secure: true })).toMatchObject({
      secure: true,
      requireTLS: false,
    });
    expect(buildSmtpOptions({ ...settings, secure: false })).toMatchObject({ requireTLS: true });
  });

  it("pools and sets connection, greeting and socket timeouts", () => {
    const o = buildSmtpOptions(settings);
    expect(o).toMatchObject({ pool: true });
    expect(o.connectionTimeout).toBeGreaterThan(0);
    expect(o.greetingTimeout).toBeGreaterThan(0);
    expect(o.socketTimeout).toBeGreaterThan(0);
  });

  it("sends credentials only when both user and password are set", () => {
    expect(buildSmtpOptions(settings).auth).toBeUndefined();
    expect(buildSmtpOptions({ ...settings, user: "u" }).auth).toBeUndefined();
    expect(buildSmtpOptions({ ...settings, user: "u", password: "p" }).auth).toEqual({
      user: "u",
      pass: "p",
    });
  });

  it("allows plain text only for loopback hosts when explicitly permitted", () => {
    const local = { ...settings, host: "localhost", port: 1025, allowPlaintextLoopback: true };
    expect(buildSmtpOptions(local)).toMatchObject({ requireTLS: false, ignoreTLS: true });
    expect(buildSmtpOptions({ ...local, allowPlaintextLoopback: false })).toMatchObject({
      requireTLS: true,
    });
    expect(buildSmtpOptions({ ...local, host: "smtp.example.com" })).toMatchObject({
      requireTLS: true,
    });
  });
});

describe("SmtpEmailSender", () => {
  it("sends a plain-text message from the configured sender", async () => {
    const { sender, sendMail } = jsonSender();
    await sender.send(message);
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith({
      from: settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  });

  it("rejects CR/LF in the recipient, subject and sender before sending", async () => {
    const { sender, sendMail } = jsonSender();
    await expect(
      sender.send({ ...message, to: "a@example.com\r\nBcc: b@example.com" }),
    ).rejects.toThrow(/recipient/);
    await expect(sender.send({ ...message, subject: "Hi\nBcc: b@example.com" })).rejects.toThrow(
      /subject/,
    );
    const transport = createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, "sendMail");
    const badFrom = new SmtpEmailSender(
      { ...settings, from: "a@example.com\r\nBcc: b@example.com" },
      transport,
    );
    await expect(badFrom.send(message)).rejects.toThrow(/sender/);
    expect(sendMail).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a recipient list", async () => {
    const { sender } = jsonSender();
    await expect(sender.send({ ...message, to: "a@example.com, b@example.com" })).rejects.toThrow(
      /one plain address/,
    );
  });

  it("never logs the body or the link", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { sender } = jsonSender();
    await sender.send(message);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("creates its own transport lazily and fails when the server is unreachable", async () => {
    const sender = new SmtpEmailSender({ ...settings, host: "127.0.0.1", port: 1 });
    await expect(sender.send(message)).rejects.toThrow();
    sender.close();
  });
});

describe("ConsoleEmailSender", () => {
  it("marks its output as development only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await new ConsoleEmailSender("a@example.com").send(message);
    expect(String(info.mock.calls[0]?.[0])).toContain("DEV ONLY");
  });
});
