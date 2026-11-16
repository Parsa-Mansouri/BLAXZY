import { describe, expect, it } from "vitest";
import type { PackView, SheetView } from "@/server/assets";
import { DESIGN_CHANGE_PREFIX } from "@/server/damis";
import {
  DESIGN_CHANGE_WARNING,
  lockMissingWords,
  packPictures,
  packWorking,
  reviewChecks,
  sheetRejectedInARow,
  splitSheetWarnings,
  viewStateWords,
} from "./sheet-review";

describe("the design-change warning", () => {
  it("mirrors the server's design-change prefix", () => {
    expect(DESIGN_CHANGE_WARNING).toBe(DESIGN_CHANGE_PREFIX);
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
