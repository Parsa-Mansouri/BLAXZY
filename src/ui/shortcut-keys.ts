/**
 * Keyboard combos as plain data: parsing ("mod+b", "?", "alt+1", "delete"), matching against a
 * key event, display ("⌘B" on a Mac, "Ctrl+B" elsewhere) and the rules for when a combo must
 * stay out of the way (typing, browser-reserved keys). Pure functions, no React.
 */
import { isTypingTarget } from "./dom";

export interface Combo {
  /** Normalised key: a lowercase letter or digit, a symbol ("?", "\\") or a name ("enter"). */
  key: string;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/** The parts of a KeyboardEvent the matcher reads (so tests need no DOM). */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const KEY_ALIASES: Record<string, string> = {
  del: "delete",
  esc: "escape",
  return: "enter",
  space: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

/** Parses "mod+shift+k" (case-insensitive). The last part is the key; "+" itself is not a key. */
export function parseCombo(combo: string): Combo {
  const parts = combo
    .trim()
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const result: Combo = { key: "", mod: false, ctrl: false, meta: false, alt: false, shift: false };
  parts.forEach((part, index) => {
    if (index < parts.length - 1) {
      if (part === "mod") result.mod = true;
      else if (part === "ctrl" || part === "control") result.ctrl = true;
      else if (part === "meta" || part === "cmd" || part === "command") result.meta = true;
      else if (part === "alt" || part === "option") result.alt = true;
      else if (part === "shift") result.shift = true;
      else throw new Error(`Unknown modifier "${part}" in shortcut "${combo}"`);
      return;
    }
    result.key = KEY_ALIASES[part] ?? part;
  });
  if (!result.key) throw new Error(`Shortcut "${combo}" has no key`);
  return result;
}

const isLetter = (key: string) => /^[a-z]$/.test(key);
const isDigit = (key: string) => /^[0-9]$/.test(key);
/** A single printable character that is not a letter or digit: "?", "[", "\\". */
const isSymbol = (key: string) => key.length === 1 && !isLetter(key) && !isDigit(key);

/** Has a ⌘/Ctrl part: the only combos that may fire while the person is typing. */
export function hasCommandModifier(combo: Combo): boolean {
  return combo.mod || combo.ctrl || combo.meta;
}

/** True when `event` presses `combo`. `mod` is ⌘ on a Mac and Ctrl elsewhere. */
export function matchesCombo(combo: Combo, event: KeyLike, isMac: boolean): boolean {
  const wantCtrl = combo.ctrl || (combo.mod && !isMac);
  const wantMeta = combo.meta || (combo.mod && isMac);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== combo.alt) {
    return false;
  }
  // Symbols are typed with Shift on many layouts ("?" is Shift+/), so Shift is not checked.
  if (!isSymbol(combo.key) && event.shiftKey !== combo.shift) return false;

  const key = event.key.toLowerCase();
  if (key === combo.key) return true;
  // The Mac's Delete key is Backspace.
  if (combo.key === "delete" && key === "backspace") return true;
  // Option changes the character on a Mac (⌥1 types "¡"): fall back to the physical key.
  if (isDigit(combo.key)) {
    return event.code === `Digit${combo.key}` || event.code === `Numpad${combo.key}`;
  }
  if (isLetter(combo.key) && combo.alt) return event.code === `Key${combo.key.toUpperCase()}`;
  return false;
}

/** Browser keys a page must never take: new window/tab, close tab, address bar, tab 1–9, reload, quit. */
const RESERVED_KEYS = new Set(["n", "t", "w", "l", "r", "q", "tab"]);

/** True for combos the browser owns (Ctrl/⌘ + N, T, W, L, R, Q, 1–9, Ctrl+Shift+N …). */
export function isReservedCombo(combo: Combo): boolean {
  if (!hasCommandModifier(combo) || combo.alt) return false;
  return RESERVED_KEYS.has(combo.key) || /^[1-9]$/.test(combo.key);
}

export interface TypingOptions {
  /** Let a ⌘/Ctrl combo fire inside rich-text editors too (where ⌘B means bold). */
  inEditable?: boolean;
}

/**
 * Containers whose keystrokes belong to them: single keys pressed inside a dialog, a menu or a
 * list box never reach page shortcuts (a menu uses letters to jump between its items).
 */
export const KEYBOARD_OWNERS =
  "[role='dialog'], [role='alertdialog'], [role='menu'], [role='menubar'], [role='listbox']";

/**
 * True when the combo must not fire for a key pressed on `target`: single keys, Shift and Alt
 * combos are left to fields, editors, dialogs and menus; ⌘/Ctrl combos are left only to
 * rich-text editors (unless `inEditable`).
 */
export function blockedByTyping(
  combo: Combo,
  target: EventTarget | null,
  options: TypingOptions = {},
): boolean {
  if (hasCommandModifier(combo)) {
    if (options.inEditable) return false;
    return typeof HTMLElement !== "undefined" && target instanceof HTMLElement
      ? target.isContentEditable
      : false;
  }
  return isTypingTarget(target, KEYBOARD_OWNERS);
}

const INTERACTIVE =
  "a[href], button, input, select, textarea, summary, [role='button'], [role='link'], " +
  "[role='menuitem'], [role='option'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch']";

/** True when Enter on `target` already does something (follows a link, presses a button). */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.matches(INTERACTIVE);
}

const MAC_KEYS: Record<string, string> = {
  enter: "↩",
  delete: "⌫",
  backspace: "⌫",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
  tab: "⇥",
};

const PC_KEYS: Record<string, string> = {
  enter: "Enter",
  delete: "Del",
  backspace: "Backspace",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
  tab: "Tab",
};

/** "mod+b" as "⌘B" on a Mac and "Ctrl+B" elsewhere; "alt+1" as "⌥1" / "Alt+1"; "r" as "R". */
export function formatShortcut(combo: string, isMac: boolean): string {
  const parsed = parseCombo(combo);
  const names = isMac ? MAC_KEYS : PC_KEYS;
  const key = names[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  if (isMac) {
    return (
      (parsed.ctrl ? "⌃" : "") +
      (parsed.alt ? "⌥" : "") +
      (parsed.shift ? "⇧" : "") +
      (parsed.mod || parsed.meta ? "⌘" : "") +
      key
    );
  }
  const parts: string[] = [];
  if (parsed.mod || parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Win");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** True on Apple platforms, from `navigator.platform` or the user agent. */
export function isMacPlatform(platformOrAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platformOrAgent);
}

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
