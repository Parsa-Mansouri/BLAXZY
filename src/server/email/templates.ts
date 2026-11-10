import type { EmailMessage } from "./sender";

type Recipient = { email: string; name?: string | null };

function greeting(name?: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? `Hi ${trimmed},` : "Hi,";
}

export function verificationEmail(to: Recipient, url: string): EmailMessage {
  return {
    to: to.email,
    subject: "Confirm your email for BLAXZY",
    actionUrl: url,
    text: [
      greeting(to.name),
      "",
      "Thanks for signing up for BLAXZY. Please confirm that this is your email address by",
      "opening the link below:",
      "",
      url,
      "",
      "The link works once and expires in 1 hour.",
      "",
      "If you did not create a BLAXZY account, you can ignore this email.",
      "",
      "BLAXZY",
    ].join("\n"),
  };
}

export function passwordResetEmail(to: Recipient, url: string): EmailMessage {
  return {
    to: to.email,
    subject: "Reset your BLAXZY password",
    actionUrl: url,
    text: [
      greeting(to.name),
      "",
      "We received a request to reset the password for your BLAXZY account. To choose a new",
      "password, open the link below:",
      "",
      url,
      "",
      "The link works once and expires in 1 hour. Resetting your password signs you out on",
      "every device.",
      "",
      "If you did not ask for this, you can ignore this email; your password stays the same.",
      "",
      "BLAXZY",
    ].join("\n"),
  };
}
