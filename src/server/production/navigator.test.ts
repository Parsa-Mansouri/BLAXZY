import { describe, expect, it } from "vitest";
import { productionNavigatorStatuses } from "./read";
import { emptyCounts } from "./stage";

describe("productionNavigatorStatuses", () => {
  it("maps the shot stages onto Shots, Clips and Finished", () => {
    const counts = {
      ...emptyCounts(),
      preparing: 2,
      prepare_failed: 1,
      block_review: 3,
      approved: 4,
      draft_generating: 5,
      draft_review: 6,
      final_generating: 7,
      final_review: 8,
      done: 9,
      failed: 10,
    };
    expect(productionNavigatorStatuses(counts)).toEqual({
      shots: { toReview: 3, rendering: 2, failed: 1 },
      clips: { toReview: 14, rendering: 12, failed: 10 },
      finished: true,
    });
  });

  it("has nothing to say about a project without shots", () => {
    expect(productionNavigatorStatuses(emptyCounts())).toEqual({
      shots: { toReview: 0, rendering: 0, failed: 0 },
      clips: { toReview: 0, rendering: 0, failed: 0 },
      finished: false,
    });
  });
});
