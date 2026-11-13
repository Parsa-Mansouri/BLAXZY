/**
 * True when a key press belongs to something the person is typing into: an editable element, an
 * input, textarea or select. `extraSelectors` (a CSS selector list) adds containers whose
 * keystrokes are also theirs: the target or an ancestor matching it counts, for example
 * "[role='dialog']".
 */
export function isTypingTarget(target: EventTarget | null, extraSelectors?: string): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    (extraSelectors !== undefined && target.closest(extraSelectors) !== null)
  );
}
