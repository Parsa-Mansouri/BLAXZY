import { describe, expect, it } from "vitest";
import { attentionWords, needsReview } from "./block-state";

describe("attentionWords", () => {
  it("says what needs attention without a total", () => {
    expect(attentionWords({ block_review: 3, approved: 4 })).toBe("3 to review.");
    expect(attentionWords({ block_review: 1, prepare_failed: 2 })).toBe(
      "1 to review, 2 need attention.",
    );
    expect(attentionWords({ preparing: 5 })).toBe("5 preparing.");
  });

  it("says so when everything is approved", () => {
    expect(attentionWords({ approved: 7 })).toBe("All shots are approved.");
  });

  it("is empty when nothing is known", () => {
    expect(attentionWords({})).toBe("");
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
