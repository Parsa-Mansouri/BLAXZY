/**
 * The texts a poll's quiet failure carries. Plain constants with no server imports, so both the
 * server actions and the browser-side poll client can use them.
 */
export const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";
export const TOO_MANY_REQUESTS = "Too many requests; try again in a moment.";
export const SIGNED_OUT = "You are signed out. Sign in again to continue.";

/**
 * `message` followed by the request's short reference ("... Reference: 1a2b3c4d"), which the user
 * can quote and which finds the request's log lines and error report. Without one, `message`.
 */
export function withReference(message: string, reference: string | undefined): string {
  return reference ? `${message} Reference: ${reference}` : message;
}
