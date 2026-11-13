import { describe, expect, it } from "vitest";
import { createAbortSlot, MAX_BACKOFF_MS, nextDelay, shouldWakePoll } from "./use-polling";

describe("nextDelay", () => {
  it("is the interval after a success", () => {
    expect(nextDelay({ intervalMs: 2000, failures: 0 })).toBe(2000);
  });

  it("doubles with each failure (no jitter at random 0.5)", () => {
    const random = () => 0.5;
    expect(nextDelay({ intervalMs: 2000, failures: 1, random })).toBe(4000);
    expect(nextDelay({ intervalMs: 2000, failures: 2, random })).toBe(8000);
    expect(nextDelay({ intervalMs: 2000, failures: 3, random })).toBe(16000);
  });

  it("caps the backoff, jitter included", () => {
    expect(nextDelay({ intervalMs: 10000, failures: 12, random: () => 1 })).toBe(MAX_BACKOFF_MS);
    expect(nextDelay({ intervalMs: 2000, failures: 1000, random: () => 1 })).toBe(MAX_BACKOFF_MS);
  });

  it("jitters within 25% either way", () => {
    expect(nextDelay({ intervalMs: 2000, failures: 1, random: () => 0 })).toBe(3000);
    expect(nextDelay({ intervalMs: 2000, failures: 1, random: () => 1 })).toBe(5000);
  });
});

describe("shouldWakePoll", () => {
  it("polls when nothing has polled yet", () => {
    expect(shouldWakePoll({ now: 5, lastStartedAt: null })).toBe(true);
  });

  it("skips a wake that comes right after a poll", () => {
    expect(shouldWakePoll({ now: 1500, lastStartedAt: 1000 })).toBe(false);
  });

  it("polls once the minimum gap has passed", () => {
    expect(shouldWakePoll({ now: 2000, lastStartedAt: 1000 })).toBe(true);
    expect(shouldWakePoll({ now: 1999, lastStartedAt: 1000, minGapMs: 500 })).toBe(true);
  });
});

describe("createAbortSlot", () => {
  it("hands out a live signal and aborts it on abort()", () => {
    const slot = createAbortSlot();
    const signal = slot.begin();
    expect(signal.aborted).toBe(false);
    slot.abort();
    expect(signal.aborted).toBe(true);
  });

  it("aborts a previous poll's signal when the next one begins", () => {
    const slot = createAbortSlot();
    const first = slot.begin();
    const second = slot.begin();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it("does nothing on abort() when no poll ever began, and twice is harmless", () => {
    const slot = createAbortSlot();
    expect(() => slot.abort()).not.toThrow();
    const signal = slot.begin();
    slot.abort();
    expect(() => slot.abort()).not.toThrow();
    expect(signal.aborted).toBe(true);
  });
});
