/** User-facing messages shared by Production's services (a leaf: no imports). */
export const NEEDS_REASON = "Tell us what is wrong: pick an issue or write a note.";

export const NOT_IN_REVIEW = "This is no longer waiting for review. Reload the page.";

export const BUSY_MESSAGE =
  "This shot is still being worked on. Wait for it to finish, then try again.";

/** Why the film cannot be finished or downloaded whole yet (no "x of y" totals). */
export function notFinalMessage(notFinal: number): string {
  return notFinal === 1
    ? "Finish every shot first. 1 shot is not final yet."
    : `Finish every shot first. ${notFinal} shots are not final yet.`;
}
