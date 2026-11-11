import { describe, expect, it } from "vitest";
import type { BlockProductionStage, TakeView } from "@/server/production";
import {
  detailKey,
  formatClock,
  formatLength,
  isUnsettled,
  newestPlayable,
  promptParts,
  shotTitle,
  statusLine,
  statusTone,
  takeLabels,
  type StageCounts,
} from "./clip-view";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 10, minute));

function take(n: number, patch: Partial<TakeView> = {}): TakeView {
  return {
    id: `take-${n}`,
    takeNumber: n,
    stage: "draft",
    status: "rejected",
    fileId: `file-${n}`,
    posterFileId: `poster-${n}`,
    failure: null,
    isSample: true,
    priceCredits: 20,
    createdAt: at(n),
    decidedAt: null,
    ...patch,
  };
}

function counts(patch: Partial<Record<BlockProductionStage, number>>): StageCounts {
  return {
    preparing: 0,
    prepare_failed: 0,
    block_review: 0,
    approved: 0,
    draft_generating: 0,
    draft_review: 0,
    final_generating: 0,
    final_review: 0,
    done: 0,
    failed: 0,
    ...patch,
  };
}

describe("statusLine", () => {
  it("says what needs attention, never a total", () => {
    expect(
      statusLine(counts({ draft_review: 1, final_review: 1, draft_generating: 1, done: 4 })),
    ).toBe("2 to review · 1 rendering");
    expect(statusLine(counts({ failed: 1, final_generating: 2 }))).toBe("1 failed · 2 rendering");
    expect(statusLine(counts({ draft_review: 2, failed: 1 }))).toBe("2 to review · 1 failed");
  });

  it("says when every shot is final, and when there is nothing to do", () => {
    expect(statusLine(counts({ done: 7 }))).toBe("Every shot is final");
    expect(statusLine(counts({}))).toBe("No shots yet");
    expect(statusLine(counts({ block_review: 2, done: 1 }))).toBe("2 in shot review");
  });
});

describe("statusTone", () => {
  it("is red for a failure, amber for a review, green when final, else grey", () => {
    expect(statusTone(counts({ failed: 1, draft_review: 1 }))).toBe("failed");
    expect(statusTone(counts({ draft_review: 1, draft_generating: 2 }))).toBe("waiting");
    expect(statusTone(counts({ done: 3 }))).toBe("done");
    expect(statusTone(counts({ draft_generating: 1, done: 3 }))).toBe("working");
  });
});

describe("takeLabels", () => {
  it("numbers drafts in order and names a single final Final", () => {
    const takes = [
      take(4, { stage: "final", status: "in_review" }),
      take(3, { status: "accepted" }),
      take(2),
      take(1),
    ];
    const labels = takeLabels(takes);
    expect(labels.get("take-1")).toBe("Draft 1");
    expect(labels.get("take-3")).toBe("Draft 3");
    expect(labels.get("take-4")).toBe("Final");
  });

  it("numbers finals when there is more than one", () => {
    const labels = takeLabels([
      take(4, { stage: "final" }),
      take(3),
      take(2, { stage: "final" }),
      take(1),
    ]);
    expect(labels.get("take-2")).toBe("Final 1");
    expect(labels.get("take-4")).toBe("Final 2");
    expect(labels.get("take-3")).toBe("Draft 2");
  });
});

describe("newestPlayable", () => {
  it("skips takes without a clip and replaced takes", () => {
    const takes = [
      take(4, { status: "pending", fileId: null }),
      take(3, { status: "superseded" }),
      take(2, { status: "accepted" }),
    ];
    expect(newestPlayable(takes)?.id).toBe("take-2");
    expect(newestPlayable([take(1, { fileId: null, status: "failed" })])).toBeNull();
  });
});

describe("promptParts", () => {
  it("replaces tokens with the names of the assets in order", () => {
    const parts = promptParts("<<<image_1>>> walks to <<<image_2>>>. <<<image_3>>>", [
      { name: "Mara" },
      { name: "The Pier" },
    ]);
    expect(parts).toEqual([
      { kind: "asset", index: 1, name: "Mara" },
      { kind: "text", text: " walks to " },
      { kind: "asset", index: 2, name: "The Pier" },
      { kind: "text", text: ". " },
      { kind: "asset", index: 3, name: "Reference 3" },
    ]);
    expect(promptParts("No tokens.", [])).toEqual([{ kind: "text", text: "No tokens." }]);
  });
});

describe("small helpers", () => {
  it("formats the clock and the length", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(4.27)).toBe("0:04.2");
    expect(formatClock(65.5, false)).toBe("1:05");
    expect(formatClock(Number.NaN)).toBe("0:00.0");
    expect(formatLength(5)).toBe("5 seconds");
    expect(formatLength(65)).toBe("1 minute 5 seconds");
    expect(formatLength(null)).toBeNull();
  });

  it("names untitled shots by number", () => {
    expect(shotTitle({ title: null, orderIndex: 2 })).toBe("Shot 3");
    expect(shotTitle({ title: "  The Pier ", orderIndex: 0 })).toBe("The Pier");
  });

  it("keeps polling fast while anything renders", () => {
    expect(isUnsettled("draft_generating")).toBe(true);
    expect(isUnsettled("draft_review")).toBe(false);
    expect(isUnsettled("done", true)).toBe(true);
  });

  it("changes the key when a take changes", () => {
    const base = { id: "b", stage: "draft_review" as const, busy: false, takes: [take(1)] };
    const changed = { ...base, takes: [take(1, { status: "accepted" })] };
    expect(detailKey(base)).not.toBe(detailKey(changed));
  });
});
