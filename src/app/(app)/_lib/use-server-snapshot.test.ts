import { describe, expect, it } from "vitest";
import { mergeLoadedPages } from "./use-server-snapshot";

type Row = { id: string; v: number };
const row = (id: string, v = 0): Row => ({ id, v });
const merge = (
  current: Row[],
  currentCursor: string | null,
  fresh: Row[],
  freshCursor: string | null,
) => mergeLoadedPages({ current, currentCursor, fresh, freshCursor, id: (r) => r.id });

describe("mergeLoadedPages", () => {
  it("keeps the later pages and the cursor when a refresh returns page one", () => {
    const current = [row("a"), row("b"), row("c"), row("d")];
    const out = merge(current, "after-d", [row("a", 1), row("b", 1)], "after-b");
    expect(out.items).toEqual([row("a", 1), row("b", 1), row("c"), row("d")]);
    expect(out.cursor).toBe("after-d");
  });

  it("replaces overlapping items with the fresh ones", () => {
    const out = merge([row("a"), row("b")], "x", [row("a", 9), row("b", 9)], "y");
    expect(out.items).toEqual([row("a", 9), row("b", 9)]);
  });

  it("takes the fresh cursor when the fresh page covers everything held", () => {
    const out = merge([row("a"), row("b")], "old", [row("a"), row("b"), row("c")], "new");
    expect(out.items.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out.cursor).toBe("new");
  });

  it("drops items removed from the part the fresh page covers", () => {
    const out = merge([row("a"), row("b"), row("c")], "x", [row("a"), row("c")], "y");
    expect(out.items.map((r) => r.id)).toEqual(["a", "c"]);
    expect(out.cursor).toBe("y");
  });

  it("does not duplicate a later item the fresh page now includes", () => {
    const out = merge([row("a"), row("b"), row("c"), row("d")], "z", [row("a"), row("c")], "y");
    expect(out.items.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(out.cursor).toBe("z");
  });

  it("uses the fresh page when nothing overlaps or nothing is held", () => {
    expect(merge([row("a")], "x", [row("q")], "y")).toEqual({ items: [row("q")], cursor: "y" });
    expect(merge([], null, [row("q")], "y")).toEqual({ items: [row("q")], cursor: "y" });
    expect(merge([row("a")], "x", [], null)).toEqual({ items: [], cursor: null });
  });
});
