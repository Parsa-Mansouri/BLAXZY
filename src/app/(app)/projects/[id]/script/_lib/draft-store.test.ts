import { describe, expect, it, vi } from "vitest";
import { createDraftStore, STORAGE_PREFIX, stillThere, type DraftComment } from "./draft-store";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const comment = (id: string, note = "x", start = 0, end = 3): DraftComment => ({
  id,
  quote: "abc",
  start,
  end,
  note,
});

describe("createDraftStore", () => {
  it("reads stored drafts without removing them", () => {
    const storage = fakeStorage({ [STORAGE_PREFIX + "v1"]: JSON.stringify([comment("a")]) });
    const store = createDraftStore(storage);
    expect(store.get("v1")).toEqual([comment("a")]);
    expect(storage.data.has(STORAGE_PREFIX + "v1")).toBe(true);
  });

  it("keeps each version's drafts apart", () => {
    const storage = fakeStorage();
    const store = createDraftStore(storage);
    store.set("v1", [comment("a")]);
    expect(store.get("v2")).toEqual([]);
    expect(storage.data.has(STORAGE_PREFIX + "v2")).toBe(false);
    expect(JSON.parse(storage.data.get(STORAGE_PREFIX + "v1") ?? "[]")).toHaveLength(1);
  });

  it("returns the same array until something changes, and notifies", () => {
    const store = createDraftStore(fakeStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.get("v1")).toBe(store.get("v1"));
    store.set("v1", [comment("a")]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not persist empty notes and clears the key when none is left", () => {
    const storage = fakeStorage();
    const store = createDraftStore(storage);
    store.set("v1", [comment("a", "  ")]);
    expect(storage.data.size).toBe(0);
    store.set("v1", [comment("a", "real")]);
    expect(storage.data.size).toBe(1);
    store.set("v1", []);
    expect(storage.data.size).toBe(0);
  });

  it("works without storage", () => {
    const store = createDraftStore(null);
    store.set("v1", [comment("a")]);
    expect(store.get("v1")).toHaveLength(1);
  });

  it("ignores corrupt stored data", () => {
    const store = createDraftStore(fakeStorage({ [STORAGE_PREFIX + "v1"]: "{oops" }));
    expect(store.get("v1")).toEqual([]);
  });
});

describe("stillThere", () => {
  it("keeps comments whose quote is still at its offsets", () => {
    expect(stillThere("abcdef")(comment("a"))).toBe(true);
    expect(stillThere("xxxdef")(comment("a"))).toBe(false);
  });
});
