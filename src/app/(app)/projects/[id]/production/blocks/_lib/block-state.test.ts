import { describe, expect, it } from "vitest";
import { attentionTone, attentionWords, needsReview } from "./block-state";

describe("attentionWords", () => {
  it("says what needs attention without a total", () => {
    expect(attentionWords({ block_review: 3, approved: 4 })).toBe("3 to review");
    expect(attentionWords({ block_review: 2, prepare_failed: 1 })).toBe("2 to review · 1 failed");
    expect(attentionWords({ preparing: 5 })).toBe("5 preparing");
  });

  it("says so when everything is approved", () => {
    expect(attentionWords({ approved: 7 })).toBe("Every shot is approved");
  });

  it("is empty when nothing is known", () => {
    expect(attentionWords({})).toBe("");
  });
});

describe("attentionTone", () => {
  it("is red for a failure, amber for a review, grey while preparing, else green", () => {
    expect(attentionTone({ block_review: 1, prepare_failed: 1 })).toBe("failed");
    expect(attentionTone({ block_review: 1, preparing: 2 })).toBe("waiting");
    expect(attentionTone({ preparing: 2 })).toBe("working");
    expect(attentionTone({ approved: 3 })).toBe("done");
  });
});

describe("needsReview", () => {
  it("is true for shots waiting for a decision", () => {
    expect(needsReview("block_review")).toBe(true);
    expect(needsReview("prepare_failed")).toBe(true);
    expect(needsReview("approved")).toBe(false);
    expect(needsReview("preparing")).toBe(false);
  });
});
