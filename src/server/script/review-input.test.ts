import { describe, expect, it } from "vitest";
import { MAX_REVIEW_NOTE_CHARS, submitReviewSchema } from "./schemas";

const BASE = { projectId: "p1", userId: "u1", versionId: "v1", decision: "rejected" as const };

describe("a script change request", () => {
  it("takes the user's words only: reason codes from a client are dropped", () => {
    const parsed = submitReviewSchema.parse({
      ...BASE,
      issueCodes: ["ending_weak"],
      note: "  Warmer ending.  ",
    });
    expect(parsed).not.toHaveProperty("issueCodes");
    expect(parsed.note).toBe("Warmer ending.");
  });

  it("keeps the note to 2,000 characters", () => {
    expect(MAX_REVIEW_NOTE_CHARS).toBe(2000);
    expect(() =>
      submitReviewSchema.parse({ ...BASE, note: "x".repeat(MAX_REVIEW_NOTE_CHARS + 1) }),
    ).toThrow(/2,000/);
  });
});
