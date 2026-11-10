import { describe, expect, it } from "vitest";
import {
  dismissedStorageKey,
  getBrowserStorage,
  readDismissed,
  writeDismissed,
  type KeyValueStorage,
} from "./dismissed-store";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("dismissed store", () => {
  it("round-trips a dismissal under a namespaced key", () => {
    const storage = memoryStorage();
    expect(readDismissed(storage, "wizard-intro")).toBe(false);
    expect(writeDismissed(storage, "wizard-intro", true)).toBe(true);
    expect(storage.data.has(dismissedStorageKey("wizard-intro"))).toBe(true);
    expect(readDismissed(storage, "wizard-intro")).toBe(true);
    expect(readDismissed(storage, "other")).toBe(false);
    writeDismissed(storage, "wizard-intro", false);
    expect(readDismissed(storage, "wizard-intro")).toBe(false);
  });

  it("never throws when storage is missing or blocked", () => {
    expect(readDismissed(null, "k")).toBe(false);
    expect(writeDismissed(null, "k", true)).toBe(false);
    expect(readDismissed(throwing, "k")).toBe(false);
    expect(writeDismissed(throwing, "k", true)).toBe(false);
  });

  it("returns null storage on the server", () => {
    expect(getBrowserStorage()).toBeNull();
  });
});
