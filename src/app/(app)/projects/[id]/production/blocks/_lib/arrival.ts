/**
 * Set before Approve moves on to the next shot (or back to the list): the page that arrives takes
 * focus at its heading, so keyboard and screen reader users are not left on the page's body.
 * Browser-only state of this tab.
 */
let arriving = false;

export function markArrival(): void {
  arriving = true;
}

/** True once after `markArrival`. */
export function takeArrival(): boolean {
  const was = arriving;
  arriving = false;
  return was;
}

/** True when nothing has focus: the control that had it was removed or disabled. */
export function focusIsFree(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}
