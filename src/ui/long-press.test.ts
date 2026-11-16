import { describe, expect, it } from "vitest";
import { absoluteUrl, imageExtras, linkExtras, normalizeActions } from "./action-items";
import { LongPressGuard } from "./long-press";

describe("LongPressGuard", () => {
  it("swallows the one click after a long press opened the menu", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 10, 10);
    guard.menuOpened();
    guard.touchEnd(520);
    expect(guard.shouldSuppressClick(530)).toBe(true);
    expect(guard.shouldSuppressClick(540)).toBe(false);
  });

  it("swallows the click after a touch held past the delay", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 0, 0);
    guard.touchEnd(600);
    expect(guard.shouldSuppressClick(610)).toBe(true);
  });

  it("lets a tap through", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 0, 0);
    guard.touchEnd(120);
    expect(guard.shouldSuppressClick(130)).toBe(false);
  });

  it("lets mouse clicks through, also after a right-click menu", () => {
    const guard = new LongPressGuard();
    guard.menuOpened();
    expect(guard.shouldSuppressClick(10)).toBe(false);
  });

  it("forgets a press the finger travelled during (a scroll)", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 0, 0);
    guard.touchMove(0, 40);
    guard.touchEnd(700);
    expect(guard.shouldSuppressClick(710)).toBe(false);
  });

  it("keeps a press whose finger only trembled", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 0, 0);
    guard.touchMove(4, 6);
    guard.menuOpened();
    guard.touchEnd(520);
    expect(guard.shouldSuppressClick(530)).toBe(true);
  });

  it("forgets a cancelled touch", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 0, 0);
    guard.touchCancel();
    guard.touchEnd(700);
    expect(guard.shouldSuppressClick(710)).toBe(false);
  });

  it("stops swallowing once the window has passed", () => {
    const guard = new LongPressGuard();
    guard.touchStart(0, 0, 0);
    guard.menuOpened();
    guard.touchEnd(500);
    expect(guard.shouldSuppressClick(2000)).toBe(false);
  });
});

describe("action items", () => {
  it("drops falsy entries and empty groups", () => {
    const open = { id: "open", label: "Open", href: "/a" };
    expect(normalizeActions([[open, false, null], [undefined], []])).toEqual([[open]]);
  });

  it("builds the link and image extras", () => {
    expect(linkExtras("/projects/1").map((a) => a.label)).toEqual(["Open in New Tab", "Copy Link"]);
    expect(linkExtras("/projects/1")[0]).toMatchObject({ href: "/projects/1", newTab: true });
    expect(linkExtras("/projects/1")[1]).toMatchObject({ copy: "/projects/1" });
    expect(imageExtras("/api/files/x")[0]).toMatchObject({
      label: "Open Image in New Tab",
      href: "/api/files/x",
      newTab: true,
    });
  });

  it("makes links absolute", () => {
    expect(absoluteUrl("/projects/1", "https://app.example")).toBe(
      "https://app.example/projects/1",
    );
    expect(absoluteUrl("https://x.example/a", "https://app.example")).toBe("https://x.example/a");
  });
});
