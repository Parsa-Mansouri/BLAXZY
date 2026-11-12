import { describe, expect, it } from "vitest";
import type { PackView, SheetView } from "@/server/assets";
import {
  DESIGN_CHANGE_PREFIX,
  getReviewCatalog,
  visibleOptions,
  type ReviewOption,
} from "@/server/damis";
import {
  buildDesignChange,
  buildSheetSelections,
  cellLabel,
  DESIGN_CHANGE_WARNING,
  designRouteOption,
  EMPTY_SHEET_DRAFT,
  lockMissingWords,
  packPictures,
  packWorking,
  picksFrame,
  reviewChecks,
  rerollOption,
  sheetChips,
  sheetRejectedInARow,
  splitSheetWarnings,
  stepLabels,
  suggestedFirst,
  viewStateWords,
} from "./sheet-review";

const characterOptions = visibleOptions(getReviewCatalog("sheet-generator-character"), {
  sector: "wizard",
  context: { render_cell_numbers: true },
});
const locationOptions = visibleOptions(getReviewCatalog("sheet-generator-location"), {
  sector: "wizard",
});
const propOptions = visibleOptions(getReviewCatalog("sheet-generator-prop"), { sector: "wizard" });

const cells = [
  { slot: 1, subject: "main fabric", reason: "default" },
  { slot: 2, subject: "boots", reason: "default" },
  { slot: 4, subject: "brass buckle", reason: "signature" },
];

const find = (options: ReviewOption[], code: string) => {
  const option = options.find((o) => o.code === code);
  if (!option) throw new Error(`no ${code}`);
  return option;
};

describe("the character sheet catalog on screen", () => {
  it("mirrors the server's design-change prefix", () => {
    expect(DESIGN_CHANGE_WARNING).toBe(DESIGN_CHANGE_PREFIX);
  });

  it("shows the frame numbers' reason only when digits are drawn", () => {
    expect(characterOptions.some((o) => o.code === "ST22")).toBe(true);
  });

  it("asks for the frame first on SP01 and SP02, with the answer step's chips", () => {
    const sp01 = find(characterOptions, "SP01");
    expect(picksFrame(sp01)).toBe(true);
    expect(picksFrame(find(characterOptions, "SP03"))).toBe(false);
    expect(stepLabels(sp01).frame).toMatch(/frame/i);
    expect(sheetChips(sp01).map((c) => c.label)).toContain("Belt and buckle");
    expect(sheetChips(find(characterOptions, "SP03")).map((c) => c.label)).toEqual([
      "Lighter",
      "Darker",
      "Medium",
    ]);
  });

  it("writes a frame as the catalog displays it", () => {
    expect(cellLabel({ slot: 1, subject: "main fabric" })).toBe("1 — main fabric");
  });

  it("finds the re-roll and the design route", () => {
    expect(rerollOption(characterOptions)?.code).toBe("SR01");
    expect(designRouteOption(characterOptions)?.code).toBe("SX01");
    expect(rerollOption(locationOptions)?.code).toBe("LSR01");
    expect(designRouteOption(propOptions)?.code).toBe("ASX01");
  });

  it("suggests making it again first for random glitches", () => {
    expect(suggestedFirst(["ST01"], characterOptions)).toBeNull();
    const hit = suggestedFirst(["ST01", "ST02", "ST16"], characterOptions);
    expect(hit?.option.code).toBe("SR01");
    expect(hit?.for).toHaveLength(2);
  });
});

describe("buildSheetSelections", () => {
  it("sends the chosen frame as the slot, chips as values and words as custom text", () => {
    const built = buildSheetSelections(
      {
        ...EMPTY_SHEET_DRAFT,
        picked: ["ST20", "SP01", "SP02", "SP99", "SR01"],
        frames: { SP01: 4, SP02: 2 },
        values: { SP01: "the belt and its buckle", SP02: "as a closer macro shot" },
        texts: { SP99: "  Less empty space at the top  " },
      },
      characterOptions,
      cells,
      2000,
    );
    expect(built).toEqual({
      ok: true,
      selections: [
        { code: "ST20" },
        {
          code: "SP01",
          value: "the belt and its buckle",
          slot: { slot: 4, subject: "brass buckle" },
        },
        { code: "SP02", value: "as a closer macro shot", slot: { slot: 2, subject: "boots" } },
        { code: "SP99", customText: "Less empty space at the top" },
      ],
    });
  });

  it("needs the frame, then an answer", () => {
    const noFrame = buildSheetSelections(
      { ...EMPTY_SHEET_DRAFT, picked: ["SP01"], values: { SP01: "__auto__" } },
      characterOptions,
      cells,
      2000,
    );
    expect(noFrame).toMatchObject({ ok: false, code: "SP01" });
    const noAnswer = buildSheetSelections(
      { ...EMPTY_SHEET_DRAFT, picked: ["SP01"], frames: { SP01: 1 } },
      characterOptions,
      cells,
      2000,
    );
    expect(noAnswer).toMatchObject({ ok: false, code: "SP01" });
  });

  it("needs the words of a location view's text items", () => {
    expect(
      buildSheetSelections({ ...EMPTY_SHEET_DRAFT, picked: ["LSP01"] }, locationOptions, [], 2000),
    ).toMatchObject({ ok: false, code: "LSP01" });
    expect(
      buildSheetSelections(
        { ...EMPTY_SHEET_DRAFT, picked: ["LST02", "LSP01"], texts: { LSP01: "From the door" } },
        locationOptions,
        [],
        2000,
      ),
    ).toEqual({
      ok: true,
      selections: [{ code: "LST02" }, { code: "LSP01", customText: "From the door" }],
    });
  });
});

describe("buildDesignChange", () => {
  const route = designRouteOption(characterOptions);
  it("sends the route with the user's words", () => {
    expect(buildDesignChange(route, "  Make the coat red  ", 2000)).toEqual({
      ok: true,
      selections: [{ code: "SX01", customText: "Make the coat red" }],
    });
  });
  it("refuses blank or long words", () => {
    expect(buildDesignChange(route, " ", 2000).ok).toBe(false);
    expect(buildDesignChange(route, "x".repeat(20), 10).ok).toBe(false);
    expect(buildDesignChange(null, "words", 2000).ok).toBe(false);
  });
});

describe("splitSheetWarnings", () => {
  it("takes out the refused design changes", () => {
    expect(
      splitSheetWarnings([
        "DESIGN_CHANGE_REQUESTED: make the coat red",
        " Frame 3 was blank, filled with the belt. ",
        "",
      ]),
    ).toEqual({
      designChanges: ["make the coat red"],
      others: ["Frame 3 was blank, filled with the belt."],
    });
  });
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 10, minute));

function sheet(n: number, patch: Partial<SheetView> = {}): SheetView {
  return {
    id: `sheet-${n}`,
    versionNumber: n,
    lookId: "look-1",
    status: "rejected",
    fileId: `file-${n}`,
    spec: null,
    parentId: null,
    failure: null,
    isSample: true,
    createdAt: at(n),
    decidedAt: null,
    ...patch,
  };
}

describe("sheetRejectedInARow", () => {
  it("counts the rejected sheets of the same design before the newest", () => {
    expect(sheetRejectedInARow([])).toBe(0);
    expect(
      sheetRejectedInARow([
        sheet(4, { status: "in_review" }),
        sheet(3),
        sheet(2),
        sheet(1, { lookId: "look-0" }),
      ]),
    ).toBe(2);
  });
});

function view(n: number, patch: Partial<PackView> = {}): PackView {
  return {
    id: `view-${n}`,
    viewId: `v${n}`,
    versionNumber: 1,
    label: `View ${n}`,
    position: n,
    status: "in_review",
    purpose: null,
    fileId: `file-view-${n}`,
    aspectRatio: "16:9",
    mustShow: [],
    mustNotShow: [],
    reviewFocus: [],
    newHypotheses: [],
    editMode: "full",
    warnings: [],
    waitingFor: [],
    parentId: null,
    failure: null,
    isSample: true,
    createdAt: at(n),
    decidedAt: null,
    ...patch,
  };
}

describe("pack words", () => {
  it("says what a view waits for", () => {
    expect(
      viewStateWords(view(1, { status: "planned", waitingFor: ["Reverse Wide", "Door"] })),
    ).toBe("Waiting for Reverse Wide and Door");
    expect(viewStateWords(view(1, { status: "pending" }))).toBe("Being made");
  });

  it("says what the lock still needs", () => {
    const views = [view(1, { label: "Reverse Wide" }), view(2, { label: "Door Detail" })];
    expect(lockMissingWords(["Reverse Wide", "Door Detail"], views)).toEqual([
      "Approve Reverse Wide and Door Detail first.",
    ]);
    expect(lockMissingWords(["Reverse", "Views still being made"], views)).toEqual([
      "Approve Reverse first.",
      "Wait for the views still being made.",
    ]);
    expect(lockMissingWords(["The views are still being planned."], views)).toEqual([
      "The views are still being planned.",
    ]);
  });

  it("works while a view is being made or is next", () => {
    expect(packWorking([view(1)])).toBe(false);
    expect(packWorking([view(1, { status: "planned", waitingFor: ["View 2"] })])).toBe(false);
    expect(packWorking([view(1, { status: "planned" })])).toBe(true);
    expect(packWorking([view(1, { status: "pending", fileId: null })])).toBe(true);
  });

  it("turns a prop's focus keys into checks and keeps a location's", () => {
    expect(reviewChecks("prop", ["shape", "new_key"])).toEqual([
      "The shape matches the Hero.",
      "new key",
    ]);
    expect(reviewChecks("location", ["The window stays left"])).toEqual(["The window stays left"]);
  });

  it("puts the Hero first and keeps only views with images", () => {
    const pictures = packPictures({ fileId: "hero-file", aspectRatio: "16:9" }, [
      view(1, { status: "accepted" }),
      view(2, { status: "pending", fileId: null }),
      view(3),
    ]);
    expect(pictures.map((p) => p.key)).toEqual(["hero", "view-1", "view-3"]);
    expect(
      packPictures(null, [view(1, { status: "accepted" }), view(3)], ["accepted"]).map(
        (p) => p.key,
      ),
    ).toEqual(["view-1"]);
  });
});
