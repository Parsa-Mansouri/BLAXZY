import { describe, expect, it } from "vitest";
import { videoReviewInputSchema, videoReviewOutputSchema } from "@/server/damis";
import inputFixture from "@/server/damis/video-review/fixtures/input.json";
import outputFixture from "@/server/damis/video-review/fixtures/model-output.json";
import type { ReferenceBindingEntry, ReviewIssue } from "@/server/damis";
import {
  bindingProblems,
  nextBlockIsStale,
  routeReview,
  shouldMarkNextStale,
  type RouterInput,
} from "./router";

const bind = (token: string, asset_id: string, sheet_id = ""): ReferenceBindingEntry => ({
  token,
  asset_id,
  sheet_id,
});

const GOOD = [bind("@char_1", "char_1", "s1"), bind("@char_2", "char_2"), bind("@loc_1", "loc_1")];

function issue(overrides: Partial<ReviewIssue> & { issue_id: string }): ReviewIssue {
  return {
    cause: "instruction_miss",
    kind: "staging",
    severity: "major",
    from_s: 1,
    to_s: 2,
    window: "0-4s",
    planned: "p",
    observed: "o",
    evidence: ["f01"],
    review_option_id: "",
    label: "l",
    suggested_route: "revise",
    ...overrides,
  };
}

const binding = (id: string, overrides: Partial<ReviewIssue> = {}) =>
  issue({
    issue_id: id,
    cause: "binding_suspect",
    kind: "identity",
    suggested_route: "rebind",
    window: "4-9s",
    ...overrides,
  });
const artifact = (id: string, overrides: Partial<ReviewIssue> = {}) =>
  issue({
    issue_id: id,
    cause: "ai_artifact",
    kind: "artifact_hands",
    suggested_route: "reroll",
    window: "9-12s",
    ...overrides,
  });
const miss = (id: string, overrides: Partial<ReviewIssue> = {}) =>
  issue({ issue_id: id, ...overrides });

function route(
  issues: ReviewIssue[],
  overrides: Partial<RouterInput> = {},
  confirm: string[] | "all" = "all",
) {
  return routeReview({
    issues,
    confirmedIssueIds: confirm === "all" ? issues.map((i) => i.issue_id) : confirm,
    referenceBinding: GOOD,
    blockAssets: GOOD,
    ...overrides,
  });
}

describe("bindingProblems", () => {
  it("finds nothing when the binding matches", () => {
    expect(bindingProblems(GOOD, GOOD)).toEqual([]);
  });

  it("finds a missing token, a wrong asset and a wrong sheet", () => {
    const actual = [bind("@char_1", "char_1", "other"), bind("@char_2", "char_3")];
    const problems = bindingProblems(GOOD, actual);
    expect(problems.map((p) => [p.token, p.problem])).toEqual([
      ["@char_1", "wrong_sheet"],
      ["@char_2", "wrong_asset"],
      ["@loc_1", "missing_token"],
    ]);
    expect(problems[2]?.actual).toBeNull();
  });

  it("does not check the sheet when the block names none, and ignores extra tokens", () => {
    const actual = [
      ...GOOD.slice(0, 1),
      bind("@char_2", "char_2", "any"),
      GOOD[2]!,
      bind("@x", "x"),
    ];
    expect(bindingProblems(GOOD, actual)).toEqual([]);
  });
});

describe("routeReview", () => {
  it("returns an empty plan when nothing is confirmed and there are no notes", () => {
    const plan = route([miss("i1")], {}, []);
    expect(plan).toMatchObject({
      rebind: [],
      revise: null,
      reroll: false,
      steps: [],
      regenerate: false,
    });
    expect(plan.reasons.map((r) => r.code)).toEqual(["undecided", "nothing_to_fix"]);
  });

  it("drops dismissed issues", () => {
    const plan = route([miss("i1"), miss("i2")], { dismissedIssueIds: ["i2"] }, ["i1"]);
    expect(plan.revise?.issues.map((i) => i.issue_id)).toEqual(["i1"]);
    expect(plan.reasons).toContainEqual(
      expect.objectContaining({ code: "dismissed", issueId: "i2" }),
    );
  });

  it("sends an instruction_miss to revise with the keep list", () => {
    const keep = [{ id: "k1", window: "12-15s", what: "w", label: "l" }];
    const plan = route([miss("i1")], { keepCandidates: keep });
    expect(plan.steps).toEqual(["revise"]);
    expect(plan.revise).toEqual({ issues: [miss("i1")], notes: [], keep });
    expect(plan.reroll).toBe(false);
    expect(plan.regenerate).toBe(true);
  });

  describe("rebind", () => {
    const wrong = [bind("@char_1", "char_2"), GOOD[1]!, GOOD[2]!];

    it("fixes a wrong binding in code and does nothing else for that issue", () => {
      const plan = route([binding("i1")], { referenceBinding: wrong });
      expect(plan.rebind).toEqual([
        {
          token: "@char_1",
          assetId: "char_1",
          problem: "wrong_asset",
          expected: { assetId: "char_1", sheetId: "s1" },
          actual: { assetId: "char_2", sheetId: "" },
          issueIds: ["i1"],
        },
      ]);
      expect(plan.revise).toBeNull();
      expect(plan.reroll).toBe(false);
      expect(plan.steps).toEqual(["rebind"]);
    });

    it("fixes a missing token", () => {
      const plan = route([binding("i1")], { referenceBinding: GOOD.slice(1) });
      expect(plan.rebind.map((f) => [f.token, f.problem])).toEqual([["@char_1", "missing_token"]]);
    });

    it("converts to an identity instruction_miss when the binding is right", () => {
      const plan = route([binding("i1", { kind: "location" })]);
      expect(plan.rebind).toEqual([]);
      expect(plan.revise?.issues).toEqual([
        expect.objectContaining({
          issue_id: "i1",
          cause: "instruction_miss",
          kind: "identity",
          suggested_route: "revise",
          originalCause: "binding_suspect",
        }),
      ]);
      expect(plan.steps).toEqual(["revise"]);
    });

    it("looks only at the asset the report found wrong when it says which", () => {
      // @char_2 is bound wrongly, but the identity row says char_1 is the wrong face and char_1
      // is bound correctly: the binding is right for that person, so revise.
      const bindingWrongForChar2 = [GOOD[0]!, bind("@char_2", "char_3"), GOOD[2]!];
      const identity = [{ character_id: "char_1", window: "4-9s", result: "matches_other_asset" }];
      const plan = route([binding("i1")], { referenceBinding: bindingWrongForChar2, identity });
      expect(plan.rebind).toEqual([]);
      expect(plan.revise?.issues[0]?.originalCause).toBe("binding_suspect");
      // and the other way round: char_2 is the wrong face and its binding is wrong: rebind
      const plan2 = route([binding("i1")], {
        referenceBinding: bindingWrongForChar2,
        identity: [{ character_id: "char_2", window: "4-9s", result: "matches_none" }],
      });
      expect(plan2.rebind.map((f) => f.token)).toEqual(["@char_2"]);
    });

    it("merges fixes for the same token across issues", () => {
      const plan = route([binding("i1"), binding("i2")], { referenceBinding: wrong });
      expect(plan.rebind).toHaveLength(1);
      expect(plan.rebind[0]?.issueIds).toEqual(["i1", "i2"]);
    });
  });

  describe("reroll", () => {
    it("rerolls an ai_artifact when nothing needs revise", () => {
      const plan = route([artifact("i1"), artifact("i2", { kind: "artifact_face" })]);
      expect(plan.reroll).toBe(true);
      expect(plan.revise).toBeNull();
      expect(plan.steps).toEqual(["reroll"]);
      expect(plan.deferredArtifacts).toEqual([]);
    });

    it("does not reroll when a revise issue exists; the artifacts are deferred", () => {
      const plan = route([artifact("i1"), miss("i2")]);
      expect(plan.reroll).toBe(false);
      expect(plan.steps).toEqual(["revise"]);
      expect(plan.deferredArtifacts.map((i) => i.issue_id)).toEqual(["i1"]);
      expect(plan.revise?.issues.map((i) => i.issue_id)).toEqual(["i2"]);
    });

    it("does not reroll when the user wrote a note", () => {
      const plan = route([artifact("i1")], { notes: [{ text: "make it calmer" }] });
      expect(plan.reroll).toBe(false);
      expect(plan.revise?.notes).toEqual([{ text: "make it calmer" }]);
      expect(plan.deferredArtifacts).toHaveLength(1);
    });

    it("sends the same artifact kind in the same window to revise after 2 rerolls in a row", () => {
      const plan = route([artifact("i1")], {
        currentAttemptRoute: "reroll",
        attemptHistory: [
          { route: "initial", artifacts: [] },
          { route: "reroll", artifacts: [{ kind: "artifact_hands", window: "9-12s" }] },
        ],
      });
      expect(plan.reroll).toBe(false);
      expect(plan.revise?.issues).toEqual([
        expect.objectContaining({
          issue_id: "i1",
          cause: "instruction_miss",
          originalCause: "ai_artifact",
        }),
      ]);
      expect(plan.reasons.map((r) => r.code)).toContain("artifact_loop");
    });

    it("keeps rerolling when the earlier artifact was another kind or another window", () => {
      const history = (kind: string, window: string) => ({
        currentAttemptRoute: "reroll" as const,
        attemptHistory: [{ route: "reroll" as const, artifacts: [{ kind, window }] }],
      });
      expect(route([artifact("i1")], history("artifact_face", "9-12s")).reroll).toBe(true);
      expect(route([artifact("i1")], history("artifact_hands", "0-4s")).reroll).toBe(true);
    });

    it("does not count an earlier attempt that was not a reroll, or a current one that was not", () => {
      const artifacts = [{ kind: "artifact_hands", window: "9-12s" }];
      expect(
        route([artifact("i1")], {
          currentAttemptRoute: "reroll",
          attemptHistory: [{ route: "initial", artifacts }],
        }).reroll,
      ).toBe(true);
      expect(
        route([artifact("i1")], {
          currentAttemptRoute: "revise",
          attemptHistory: [{ route: "reroll", artifacts }],
        }).reroll,
      ).toBe(true);
    });

    it("matches windows ignoring spacing", () => {
      const plan = route([artifact("i1", { window: "9 - 12s" })], {
        currentAttemptRoute: "reroll",
        attemptHistory: [
          { route: "reroll", artifacts: [{ kind: "artifact_hands", window: "9-12s" }] },
        ],
      });
      expect(plan.reroll).toBe(false);
    });
  });

  describe("user notes", () => {
    it("always go to revise, with their seconds", () => {
      const notes = [{ text: "Slower walk", fromS: 5, toS: 8 }, { text: "  " }];
      const plan = route([], { notes });
      expect(plan.revise).toEqual({ issues: [], notes: [notes[0]], keep: [] });
      expect(plan.steps).toEqual(["revise"]);
      expect(plan.reasons.map((r) => r.code)).toEqual(["user_note"]);
    });
  });

  describe("mixed", () => {
    it("orders rebind, then revise, then (never together with revise) reroll", () => {
      const wrong = [bind("@char_1", "char_2"), GOOD[1]!, GOOD[2]!];
      const plan = route([binding("i1"), miss("i2"), artifact("i3")], { referenceBinding: wrong });
      expect(plan.steps).toEqual(["rebind", "revise"]);
      expect(plan.reroll).toBe(false);
    });

    it("orders rebind then reroll when only artifacts remain", () => {
      const wrong = [bind("@char_1", "char_2"), GOOD[1]!, GOOD[2]!];
      const plan = route([binding("i1"), artifact("i3")], { referenceBinding: wrong });
      expect(plan.steps).toEqual(["rebind", "reroll"]);
      expect(plan.regenerate).toBe(true);
    });

    it("has no generation cap: a long attempt history still gets a plan", () => {
      const history = Array.from({ length: 12 }, () => ({
        route: "revise" as const,
        artifacts: [],
      }));
      const plan = route([miss("i1")], { attemptHistory: history, currentAttemptRoute: "revise" });
      expect(plan.steps).toEqual(["revise"]);
      expect(plan.reasons.every((r) => !/attention|cap|limit/i.test(r.text))).toBe(true);
    });

    it("does not change its input", () => {
      const issues = [binding("i1"), artifact("i2")];
      const snapshot = structuredClone(issues);
      route(issues, { referenceBinding: GOOD.slice(1) });
      expect(issues).toEqual(snapshot);
    });
  });
});

describe("nextBlockIsStale", () => {
  const accepted = {
    end_staging: "Mohammad at the door, hand on the handle",
    in_progress_at_end: "opening the door",
  };

  it("is not stale when the end is the same", () => {
    expect(nextBlockIsStale(accepted, { ...accepted })).toBe(false);
  });

  it("ignores case, spacing and key order", () => {
    expect(
      nextBlockIsStale(
        { end_staging: { a: "X  y", b: ["One", "Two"] }, in_progress_at_end: null },
        { end_staging: { b: ["one", "two"], a: " x y" }, in_progress_at_end: "" },
      ),
    ).toBe(false);
    expect(
      nextBlockIsStale({ end_staging: "x" }, { end_staging: "x", in_progress_at_end: [] }),
    ).toBe(false);
  });

  it("is stale when end_staging changed", () => {
    expect(
      nextBlockIsStale(accepted, { ...accepted, end_staging: "Mohammad is seated at the table" }),
    ).toBe(true);
  });

  it("is stale when in_progress_at_end changed, appeared or disappeared", () => {
    expect(
      nextBlockIsStale(accepted, { ...accepted, in_progress_at_end: "closing the door" }),
    ).toBe(true);
    expect(
      nextBlockIsStale({ end_staging: "x" }, { end_staging: "x", in_progress_at_end: "run" }),
    ).toBe(true);
    expect(nextBlockIsStale(accepted, { end_staging: accepted.end_staging })).toBe(true);
  });

  it("is not stale when nothing was recorded for the next block", () => {
    expect(nextBlockIsStale(accepted, null)).toBe(false);
  });
});

describe("shouldMarkNextStale", () => {
  const accepted = { end_staging: "a" };
  it("marks only a next block that was already generated", () => {
    const changed = { end_staging: "b" };
    expect(
      shouldMarkNextStale({ accepted, nextBlockWrittenFrom: changed, nextBlockGenerated: true }),
    ).toBe(true);
    expect(
      shouldMarkNextStale({ accepted, nextBlockWrittenFrom: changed, nextBlockGenerated: false }),
    ).toBe(false);
    expect(
      shouldMarkNextStale({ accepted, nextBlockWrittenFrom: accepted, nextBlockGenerated: true }),
    ).toBe(false);
  });
});

describe("routeReview on the video-review fixture", () => {
  const report = videoReviewOutputSchema.parse(outputFixture);
  const inputParsed = videoReviewInputSchema.parse(inputFixture);
  const base = {
    issues: report.issues,
    identity: report.identity,
    keepCandidates: report.keep_candidates,
    confirmedIssueIds: report.issues.map((i) => i.issue_id),
    referenceBinding: inputParsed.reference_binding,
    blockAssets: inputParsed.block.assets,
  };

  it("with a correct binding: the wrong person goes to revise, the hand artifact waits", () => {
    const plan = routeReview(base);
    expect(plan.steps).toEqual(["revise"]);
    expect(plan.revise?.issues.map((i) => [i.issue_id, i.kind])).toEqual([
      ["i1", "identity"],
      ["i3", "restarted_action"],
    ]);
    expect(plan.revise?.keep).toEqual(report.keep_candidates);
    expect(plan.deferredArtifacts.map((i) => i.issue_id)).toEqual(["i2"]);
  });

  it("with the wrong person bound to the wrong sheet: rebind first, then revise", () => {
    const plan = routeReview({
      ...base,
      referenceBinding: inputParsed.reference_binding.map((b) =>
        b.token === "@char_1" ? { ...b, sheet_id: "sheet_char_1_b" } : b,
      ),
    });
    expect(plan.steps).toEqual(["rebind", "revise"]);
    expect(plan.rebind).toEqual([
      expect.objectContaining({ token: "@char_1", problem: "wrong_sheet" }),
    ]);
  });

  it("with only the hand artifact confirmed: a reroll", () => {
    expect(routeReview({ ...base, confirmedIssueIds: ["i2"] }).steps).toEqual(["reroll"]);
  });
});
