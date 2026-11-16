import { describe, expect, it } from "vitest";
import { reviewReason } from "./access";
import { ProductionInputError } from "./errors";
import { blockReviewInput, MAX_REVIEW_NOTE_LENGTH, takeReviewInput } from "./inputs";

const LINEAGE = { lineageId: "l1", userId: "u1" };
const TAKE = { takeId: "t1", userId: "u1" };

describe("change requests on a block or a take", () => {
  it("take only the user's words: reason codes from a client are dropped", () => {
    const block = blockReviewInput.parse({
      ...LINEAGE,
      decision: "rejected",
      issueCodes: ["wrong_camera"],
      note: "  Closer on his hands.  ",
    });
    expect(block).not.toHaveProperty("issueCodes");
    expect(block.note).toBe("Closer on his hands.");
    const take = takeReviewInput.parse({ ...TAKE, decision: "rejected", issueCodes: ["flicker"] });
    expect(take).not.toHaveProperty("issueCodes");
  });

  it("keep the note under the limit", () => {
    const note = "x".repeat(MAX_REVIEW_NOTE_LENGTH + 1);
    expect(() => blockReviewInput.parse({ ...LINEAGE, decision: "rejected", note })).toThrow();
  });

  it("refuse a rejection without a note, and store no reason codes", () => {
    expect(() => reviewReason("rejected", undefined)).toThrow(ProductionInputError);
    expect(() => reviewReason("rejected", "")).toThrow(/write a note/);
    expect(reviewReason("rejected", "Slower push-in.")).toEqual({
      issueCodes: [],
      note: "Slower push-in.",
    });
    expect(reviewReason("accepted", undefined)).toEqual({ issueCodes: [], note: null });
  });
});
