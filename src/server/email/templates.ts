import type { EmailMessage } from "./sender";

/**
 * `name` is accepted but deliberately never used: anyone can sign up with someone else's address
 * and any display name, and the mail goes to that address, so a name in the text would let a
 * stranger put words in our mouth ("Your account is locked, go to ..."). Mail is plain text with
 * a neutral greeting.
 */
type Recipient = { email: string; name?: string | null };

const GREETING = "Hello,";

export function verificationEmail(to: Recipient, url: string): EmailMessage {
  return {
    to: to.email,
    subject: "Confirm your email for BLAXZY",
    actionUrl: url,
    text: [
      GREETING,
      "",
      "Someone used this email address to sign up for BLAXZY. To confirm that it is yours,",
      "open the link below:",
      "",
      url,
      "",
      "The link works once and expires in 1 hour.",
      "",
      "If this was not you, you can ignore this email.",
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
      GREETING,
      "",
      "We received a request to reset the password for the BLAXZY account with this email",
      "address. To choose a new password, open the link below:",
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
