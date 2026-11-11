import { describe, expect, it } from "vitest";
import {
  canStartDraftsFrom,
  deriveBlockStage,
  derivePhase,
  emptyCounts,
  isBusy,
  type StageBlock,
  type StageTake,
} from "./stage";

const ready: StageBlock = { stale: false, productionState: "ready", approvedAt: null };
const approved: StageBlock = { ...ready, approvedAt: new Date() };
const take = (stage: StageTake["stage"], status: StageTake["status"]): StageTake => ({
  stage,
  status,
});

describe("deriveBlockStage", () => {
  it("follows preparation", () => {
    expect(deriveBlockStage({ ...ready, productionState: "none" }, null)).toBe("preparing");
    expect(deriveBlockStage({ ...ready, productionState: "pending" }, null)).toBe("preparing");
    expect(deriveBlockStage({ ...ready, productionState: "failed" }, null)).toBe("prepare_failed");
    expect(deriveBlockStage(ready, null)).toBe("block_review");
    expect(deriveBlockStage(approved, null)).toBe("approved");
  });

  it("a stale block waits for new blocks whatever its takes", () => {
    expect(deriveBlockStage({ ...approved, stale: true }, take("final", "accepted"))).toBe(
      "preparing",
    );
    expect(deriveBlockStage({ ...ready, stale: true }, null)).toBe("preparing");
  });

  it("follows the latest take", () => {
    expect(deriveBlockStage(approved, take("draft", "pending"))).toBe("draft_generating");
    expect(deriveBlockStage(approved, take("draft", "in_review"))).toBe("draft_review");
    expect(deriveBlockStage(approved, take("draft", "accepted"))).toBe("final_generating");
    expect(deriveBlockStage(approved, take("final", "pending"))).toBe("final_generating");
    expect(deriveBlockStage(approved, take("final", "in_review"))).toBe("final_review");
    expect(deriveBlockStage(approved, take("final", "accepted"))).toBe("done");
    expect(deriveBlockStage(approved, take("draft", "failed"))).toBe("failed");
    expect(deriveBlockStage(approved, take("final", "failed"))).toBe("failed");
    expect(deriveBlockStage(approved, take("draft", "rejected"))).toBe("draft_generating");
  });

  it("ignores a superseded take", () => {
    expect(deriveBlockStage(ready, take("final", "superseded"))).toBe("block_review");
    expect(deriveBlockStage(approved, take("draft", "superseded"))).toBe("approved");
  });

  it("is busy while a dami or a generation works", () => {
    expect(isBusy({ ...ready, productionState: "pending" }, null)).toBe(true);
    expect(isBusy(approved, take("draft", "pending"))).toBe(true);
    expect(isBusy(approved, take("draft", "in_review"))).toBe(false);
    expect(isBusy({ ...approved, stale: true }, take("draft", "pending"))).toBe(false);
  });
});

describe("derivePhase and canStartDraftsFrom", () => {
  it("preparing, review, generating, finished", () => {
    const counts = emptyCounts();
    expect(derivePhase(counts)).toBe("preparing");
    counts.preparing = 1;
    counts.block_review = 2;
    expect(derivePhase(counts)).toBe("preparing");
    counts.preparing = 0;
    expect(derivePhase(counts)).toBe("block_review");
    expect(canStartDraftsFrom(counts)).toBe(false);
    counts.block_review = 0;
    counts.approved = 2;
    expect(derivePhase(counts)).toBe("block_review");
    expect(canStartDraftsFrom(counts)).toBe(true);
    counts.approved = 0;
    counts.draft_review = 1;
    counts.done = 1;
    expect(derivePhase(counts)).toBe("generating");
    expect(canStartDraftsFrom(counts)).toBe(false);
    counts.draft_review = 0;
    expect(derivePhase(counts)).toBe("finished");
  });

  it("a failed preparation holds the drafts back", () => {
    const counts = emptyCounts();
    counts.approved = 3;
    counts.prepare_failed = 1;
    expect(canStartDraftsFrom(counts)).toBe(false);
    expect(derivePhase(counts)).toBe("block_review");
  });
});
