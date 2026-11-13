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

/**
 * Sent when someone signs up with an address that already has an account. The sign-up answer is
 * the same as for a new address (no account enumeration), so this mail is how the owner finds out.
 * It carries no token: only where to sign in or reset the password.
 */
export function existingAccountEmail(
  to: Recipient,
  links: { signInUrl: string; resetPasswordUrl: string },
): EmailMessage {
  return {
    to: to.email,
    subject: "You already have a BLAXZY account",
    text: [
      GREETING,
      "",
      "Someone tried to sign up for BLAXZY with this email address, but it already has an",
      "account. To use it, sign in:",
      "",
      links.signInUrl,
      "",
      "If you do not remember your password, you can choose a new one here:",
      "",
      links.resetPasswordUrl,
      "",
      "If this was not you, you can ignore this email; nothing has changed on your account.",
      "",
      "BLAXZY",
    ].join("\n"),
  };
}
