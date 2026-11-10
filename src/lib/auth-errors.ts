/** Plain-words messages for failed better-auth client calls. Safe to import anywhere. */

export type AuthFailure = {
  status: number;
  code?: string;
  message?: string;
  /** Seconds to wait, from the `X-Retry-After` header on 429 responses. */
  retryAfter?: number | null;
};

export type AuthContext = "sign-in" | "sign-up" | "reset" | "change-password" | "generic";

function waitText(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "a minute";
  if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

export function describeAuthFailure(failure: AuthFailure, context: AuthContext): string {
  if (failure.status === 429) {
    return `Too many attempts. Wait ${waitText(failure.retryAfter)} and try again.`;
  }
  switch (failure.code) {
    case "ACCOUNT_DISABLED":
      return "This account has been disabled, so you cannot sign in. Contact support if you think this is a mistake.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password do not match. Check both and try again, or reset your password.";
    case "INVALID_PASSWORD":
      return "Your current password is not correct. Check it and try again.";
    case "INVALID_TOKEN":
      return "This link has expired or was already used. Request a new one.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "There is already an account with this email. Sign in instead, or reset your password.";
    case "PASSWORD_TOO_SHORT":
      return "That password is too short. Use a longer one.";
    case "PASSWORD_TOO_LONG":
      return "That password is too long. Use a shorter one.";
    default:
      break;
  }
  if (failure.status >= 500) {
    return "Something went wrong on our side. Try again in a moment.";
  }
  if (failure.status === 0) {
    return "We could not reach the server. Check your connection and try again.";
  }
  if (context === "sign-in") {
    return "We could not sign you in. Check your email and password and try again.";
  }
  if (context === "sign-up") {
    return "We could not create your account. Check the details and try again.";
  }
  return failure.message && failure.message.length < 120
    ? `${failure.message.replace(/\.$/, "")}. Check what you entered and try again.`
    : "That did not work. Check what you entered and try again.";
}

/** Builds an `AuthFailure` from a better-auth client error plus the response headers. */
export function toAuthFailure(
  error: { status: number; code?: string; message?: string },
  retryAfterHeader: string | null,
): AuthFailure {
  const parsed = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
  return {
    status: error.status,
    code: error.code,
    message: error.message,
    retryAfter: Number.isFinite(parsed) ? parsed : null,
  };
}
