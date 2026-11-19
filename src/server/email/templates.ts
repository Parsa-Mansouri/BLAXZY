import { renderEmail } from "./layout";
import type { EmailMessage } from "./sender";

/**
 * `name` is accepted but deliberately never used: anyone can sign up with someone else's address
 * and any display name, and the mail goes to that address, so a name in the mail would let a
 * stranger put words in our mouth ("Your account is locked, go to ..."). No user-supplied text goes
 * into either part (plain text with a neutral greeting, and the HTML version).
 */
type Recipient = { email: string; name?: string | null };

const GREETING = "Hello,";

/**
 * The six-digit email verification code. The code stays out of the subject (lock screens and
 * notification previews show subjects); the phrase "verification code" sits right next to the
 * digits in both parts so Gmail and iOS recognise it and offer to copy or autofill it.
 */
export function verificationCodeEmail(to: Recipient, code: string): EmailMessage {
  return {
    to: to.email,
    subject: "Your BLAXZY verification code",
    text: [
      GREETING,
      "",
      "Someone used this email address to sign up for BLAXZY. To confirm that it is yours,",
      "enter this verification code:",
      "",
      code,
      "",
      "The code works once and expires in 10 minutes.",
      "",
      "If this was not you, you can ignore this email.",
      "",
      "BLAXZY",
    ].join("\n"),
    html: renderEmail({
      preheader: "Enter this code to finish signing up for BLAXZY.",
      heading: "Confirm your email",
      paragraphs: [
        "Someone used this email address to sign up for BLAXZY. Enter this verification code to confirm that it is yours.",
      ],
      code,
      footnote:
        "The code works once and expires in 10 minutes. If this was not you, you can ignore this email.",
    }),
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
    html: renderEmail({
      preheader: "Choose a new password for your BLAXZY account.",
      heading: "Reset your password",
      paragraphs: [
        "We received a request to reset the password for the BLAXZY account with this email address.",
        "Choosing a new password signs you out of BLAXZY on every device.",
      ],
      action: { label: "Choose a new password", url },
      footnote:
        "The link works once and expires in 1 hour. If you did not ask for this, you can ignore this email; your password stays the same.",
    }),
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
    html: renderEmail({
      preheader: "This email address already has a BLAXZY account.",
      heading: "You already have an account",
      paragraphs: [
        "Someone tried to sign up for BLAXZY with this email address, but it already has an account. To use it, sign in.",
      ],
      action: { label: "Sign in", url: links.signInUrl },
      secondary: {
        lead: "Forgot your password?",
        label: "Choose a new one",
        url: links.resetPasswordUrl,
      },
      footnote:
        "If this was not you, you can ignore this email; nothing has changed on your account.",
    }),
  };
}
