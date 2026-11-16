import { describe, expect, it } from "vitest";
import type { LookView, SheetView } from "@/server/assets";
import {
  failedVersion,
  heldImage,
  historyItems,
  isCreditsFailure,
  kindSlug,
  lookOrigin,
  lookShape,
  versionsKey,
} from "./asset-view";
import { parseDraft } from "./guided-draft";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 10, minute));

function look(n: number, patch: Partial<LookView> = {}): LookView {
  return {
    id: `look-${n}`,
    versionNumber: n,
    source: "generated",
    status: "in_review",
    fileId: `file-look-${n}`,
    userPrompt: null,
    guidedAnswers: { age: "Older (60s-70s)" },
    references: [],
    clarifyAnswers: null,
    spec: null,
    aspectRatio: null,
    parentId: null,
    started: true,
    failure: null,
    isSample: true,
    createdAt: at(n),
    decidedAt: null,
    ...patch,
  };
}

function sheet(n: number, lookId: string, patch: Partial<SheetView> = {}): SheetView {
  return {
    id: `sheet-${n}`,
    versionNumber: n,
    lookId,
    status: "in_review",
    fileId: `file-sheet-${n}`,
    spec: null,
    parentId: null,
    failure: null,
    isSample: true,
    createdAt: at(30 + n),
    decidedAt: null,
    ...patch,
  };
}

describe("heldImage", () => {
  it("keeps the rejected image visible while its fix is generated", () => {
    const looks = [look(2, { status: "pending", fileId: null }), look(1, { status: "rejected" })];
    expect(heldImage({ stage: "generating", busy: true, looks, sheets: [] })).toEqual({
      fileId: "file-look-1",
      kind: "look",
      versionNumber: 1,
      aspectRatio: null,
    });
  });

  it("shows nothing for a first generation or after a rejected upload", () => {
    const first = [look(1, { status: "pending", fileId: null })];
    expect(heldImage({ stage: "generating", busy: true, looks: first, sheets: [] })).toBeNull();
    const afterUpload = [
      look(2, { status: "pending", fileId: null }),
      look(1, { status: "rejected", source: "uploaded" }),
    ];
    expect(
      heldImage({ stage: "generating", busy: true, looks: afterUpload, sheets: [] }),
    ).toBeNull();
  });

  it("shows the accepted image while the first sheet is built, the rejected sheet during a fix", () => {
    const looks = [look(1, { status: "accepted" })];
    expect(
      heldImage({
        stage: "building_sheet",
        busy: true,
        looks,
        sheets: [sheet(1, "look-1", { status: "pending", fileId: null })],
      }),
    ).toMatchObject({ kind: "look", fileId: "file-look-1" });
    expect(
      heldImage({
        stage: "building_sheet",
        busy: true,
        looks,
        sheets: [
          sheet(2, "look-1", { status: "pending", fileId: null }),
          sheet(1, "look-1", { status: "rejected" }),
        ],
      }),
    ).toMatchObject({ kind: "sheet", fileId: "file-sheet-1" });
  });
});

describe("failedVersion", () => {
  it("names the failed look or sheet", () => {
    const failedLook = [look(1, { status: "failed", fileId: null, failure: "No." })];
    expect(failedVersion({ stage: "failed", busy: false, looks: failedLook, sheets: [] })).toEqual({
      kind: "look",
      id: "look-1",
      failure: "No.",
    });
    const looks = [look(1, { status: "accepted" })];
    const sheets = [sheet(1, "look-1", { status: "failed", fileId: null, failure: "Bad." })];
    expect(failedVersion({ stage: "failed", busy: false, looks, sheets })).toEqual({
      kind: "sheet",
      id: "sheet-1",
      failure: "Bad.",
    });
    expect(failedVersion({ stage: "ready", busy: false, looks, sheets })).toBeNull();
  });
});

describe("isCreditsFailure", () => {
  it("spots the worker's credits message", () => {
    expect(isCreditsFailure("You need 4 credits for this; you have 0.")).toBe(true);
    expect(isCreditsFailure("The image could not be generated.")).toBe(false);
    expect(isCreditsFailure(null)).toBe(false);
  });
});

describe("versionsKey and historyItems", () => {
  it("changes when the latest look's status changes", () => {
    const before = versionsKey({
      stage: "generating",
      busy: true,
      looks: [look(1, { status: "pending" })],
      sheets: [],
    });
    const after = versionsKey({ stage: "look_review", busy: false, looks: [look(1)], sheets: [] });
    expect(before).not.toBe(after);
  });

  it("changes when a pack's view moves on or its contact sheet is stored", () => {
    const base = { stage: "sheet_review" as const, busy: false, looks: [look(1)] };
    const views = (status: "pending" | "in_review") => [
      {
        id: "view-1",
        viewId: "reverse_wide",
        versionNumber: 1,
        label: "Reverse Wide",
        position: 1,
        status,
        purpose: null,
        fileId: null,
        aspectRatio: "16:9" as const,
        mustShow: [],
        mustNotShow: [],
        reviewFocus: [],
        newHypotheses: [],
        editMode: "full" as const,
        warnings: [],
        waitingFor: [],
        parentId: null,
        failure: null,
        isSample: true,
        createdAt: at(1),
        decidedAt: null,
      },
    ];
    const sheets = [sheet(1, "look-1", { fileId: null })];
    expect(versionsKey({ ...base, sheets, packViews: views("pending") })).not.toBe(
      versionsKey({ ...base, sheets, packViews: views("in_review") }),
    );
    expect(versionsKey({ ...base, stage: "ready", sheets })).not.toBe(
      versionsKey({ ...base, stage: "ready", sheets: [sheet(1, "look-1")] }),
    );
  });

  it("merges looks and sheets newest first", () => {
    const items = historyItems([look(2), look(1)], [sheet(1, "look-1")]);
    expect(items.map((i) => i.key)).toEqual(["sheet:sheet-1", "look:look-2", "look:look-1"]);
  });

  it("leaves out a pack sheet that has no image yet, and keeps a failed one", () => {
    const items = historyItems(
      [look(1)],
      [
        sheet(1, "look-1", { fileId: null, status: "in_review" }),
        sheet(2, "look-1", { fileId: null, status: "failed" }),
      ],
    );
    expect(items.map((i) => i.key)).toEqual(["sheet:sheet-2", "look:look-1"]);
  });

  it("turns kind underscores into hyphens", () => {
    expect(kindSlug("some_kind")).toBe("some-kind");
  });
});

describe("parseDraft", () => {
  it("reads a stored draft and ignores anything else", () => {
    expect(parseDraft('{"answers":{"age":"Teenager","x":3},"step":2}')).toEqual({
      answers: { age: "Teenager" },
      step: 2,
    });
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft('{"answers":null,"step":1}')).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });
});

describe("lookShape and lookOrigin", () => {
  it("shows a look in its own ratio, else in the project's orientation", () => {
    expect(lookShape("1:1", "portrait")).toBe("1:1");
    expect(lookShape(null, "portrait")).toBe("portrait");
  });

  it("says how a look was made", () => {
    expect(lookOrigin(look(1))).toBe("From your answers");
    expect(lookOrigin(look(1, { guidedAnswers: null }))).toBe("Designed by BLAXZY");
    expect(
      lookOrigin(look(1, { guidedAnswers: null, references: [{ fileId: "f", role: "face" }] })),
    ).toBe("From your photos");
    const parent = look(1, { status: "rejected" });
    expect(lookOrigin(look(2, { parentId: "look-1" }), parent)).toBe("Revised after review");
  });

  it("says when an uploaded photo is used as the Hero", () => {
    const spec = {
      generator: "location-generator" as const,
      aspectRatio: "16:9" as const,
      heroMode: "use_uploaded" as const,
      styleUsed: "",
      styleSource: "",
      summary: "",
      assumptions: [],
      warnings: [],
      appliedFixes: [],
      fields: [],
      questions: [],
    };
    expect(lookOrigin(look(1, { spec }))).toBe("Your photo, used as the Hero");
  });
});
