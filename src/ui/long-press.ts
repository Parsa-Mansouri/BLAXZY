/**
 * Long-press bookkeeping for `ActionMenuTarget`: Base UI opens the context menu after a 500ms
 * hold, and this swallows the click a browser may still send when the finger lifts. Pure, no DOM.
 */

/** How long a touch must be held before the context menu opens (Base UI's long press). */
export const LONG_PRESS_MS = 500;
/** How long after the finger lifts a stray click is still swallowed. */
const SUPPRESS_WINDOW_MS = 800;
/** How far a finger may drift and still count as holding still. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Swallows the click a browser may send after a long press opened a context menu, so a wrapped
 * link or button does not also fire. Feed it touch start/end, menu opens and clicks, with times
 * from one clock (`performance.now()`).
 */
export class LongPressGuard {
  private start: { at: number; x: number; y: number } | null = null;
  private openedDuringTouch = false;
  private suppressUntil = 0;

  touchStart(now: number, x: number, y: number): void {
    this.start = { at: now, x, y };
    this.openedDuringTouch = false;
  }

  /** A finger that travels is a scroll or a drag, not a long press (Base UI's 10px rule). */
  touchMove(x: number, y: number): void {
    if (!this.start || this.openedDuringTouch) return;
    const dx = Math.abs(x - this.start.x);
    const dy = Math.abs(y - this.start.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) this.touchCancel();
  }

  /** A second finger landed or the browser took the touch over: this is no long press. */
  touchCancel(): void {
    this.start = null;
    this.openedDuringTouch = false;
  }

  menuOpened(): void {
    if (this.start) this.openedDuringTouch = true;
  }

  touchEnd(now: number): void {
    if (!this.start) return;
    const held = now - this.start.at >= LONG_PRESS_MS;
    if (this.openedDuringTouch || held) this.suppressUntil = now + SUPPRESS_WINDOW_MS;
    this.start = null;
    this.openedDuringTouch = false;
  }

  /** True (once) when this click follows a long press and must be swallowed. */
  shouldSuppressClick(now: number): boolean {
    if (this.suppressUntil === 0 || now > this.suppressUntil) return false;
    this.suppressUntil = 0;
    return true;
  }
}
