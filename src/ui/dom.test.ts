import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTypingTarget } from "./dom";

class FakeElement {
  isContentEditable = false;
  constructor(
    readonly tagName: string,
    private readonly matches: string[] = [],
  ) {}
  closest(selector: string) {
    return this.matches.includes(selector) ? this : null;
  }
}

beforeEach(() => {
  vi.stubGlobal("HTMLElement", FakeElement);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isTypingTarget", () => {
  it("is false for no target and for non-elements", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });

  it("is true for inputs, textareas, selects and editable elements", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTypingTarget(new FakeElement(tag) as unknown as EventTarget)).toBe(true);
    }
    const editable = new FakeElement("DIV");
    editable.isContentEditable = true;
    expect(isTypingTarget(editable as unknown as EventTarget)).toBe(true);
  });

  it("is false for a button, unless an extra selector matches", () => {
    const button = new FakeElement("BUTTON", ["[role='dialog']"]);
    expect(isTypingTarget(button as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(button as unknown as EventTarget, "[role='dialog']")).toBe(true);
    expect(isTypingTarget(button as unknown as EventTarget, "[role='menu']")).toBe(false);
  });
});
