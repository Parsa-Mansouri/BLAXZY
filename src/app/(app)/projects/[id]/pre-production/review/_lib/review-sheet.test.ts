import { describe, expect, it } from "vitest";
import type { AssetDetail, LookView, PackView, SheetView } from "@/server/assets";
import { reviewPicture, toReviewSheet } from "./review-sheet";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 10, minute));

const look: LookView = {
  id: "look-1",
  versionNumber: 1,
  source: "generated",
  status: "accepted",
  fileId: "hero-file",
  userPrompt: null,
  guidedAnswers: null,
  references: [],
  clarifyAnswers: null,
  spec: null,
  aspectRatio: "16:9",
  parentId: null,
  started: true,
  failure: null,
  isSample: true,
  createdAt: at(1),
  decidedAt: at(2),
};

function sheet(n: number, patch: Partial<SheetView> = {}): SheetView {
  return {
    id: `sheet-${n}`,
    versionNumber: n,
    lookId: "look-1",
    status: "in_review",
    fileId: `sheet-file-${n}`,
    spec: null,
    parentId: null,
    failure: null,
    isSample: true,
    createdAt: at(10 + n),
    decidedAt: null,
    ...patch,
  };
}

function view(n: number, status: PackView["status"], fileId: string | null): PackView {
  return {
    id: `view-${n}`,
    viewId: `v${n}`,
    versionNumber: 1,
    label: `View ${n}`,
    position: n,
    status,
    purpose: null,
    fileId,
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
    createdAt: at(20 + n),
    decidedAt: null,
  };
}

type Detail = Pick<AssetDetail, "stage" | "looks" | "sheets" | "packViews">;

describe("toReviewSheet", () => {
  it("shows a character sheet in review with its frames and refused design changes", () => {
    const detail: Detail = {
      stage: "sheet_review",
      looks: [look],
      sheets: [
        sheet(2, {
          spec: {
            maker: "sheet-generator-character",
            referenceOrder: [],
            editMode: "full",
            detailCells: [{ slot: 1, subject: "main fabric", reason: "default" }],
            styleUsed: "",
            assumptions: [],
            warnings: ["DESIGN_CHANGE_REQUESTED: red coat"],
            appliedFixes: [],
            generationOrder: [],
            designChanges: ["red coat"],
          },
        }),
        sheet(1, { status: "rejected" }),
      ],
      packViews: [],
    };
    expect(toReviewSheet(detail, null)).toEqual({
      kind: "character",
      sheetId: "sheet-2",
      fileId: "sheet-file-2",
      status: "in_review",
      cells: [{ slot: 1, subject: "main fabric", reason: "default" }],
      designChanges: ["red coat"],
      rejectedInARow: 1,
    });
  });

  it("shows nothing while a sheet is built again", () => {
    expect(
      toReviewSheet(
        { stage: "building_sheet", looks: [look], sheets: [sheet(1)], packViews: [] },
        null,
      ),
    ).toBeNull();
  });

  it("shows a pack in review as its Hero and views, with no contact sheet", () => {
    const shown = toReviewSheet(
      {
        stage: "sheet_review",
        looks: [look],
        sheets: [sheet(1, { fileId: null })],
        packViews: [
          view(1, "accepted", "f1"),
          view(2, "pending", null),
          view(3, "in_review", "f3"),
        ],
      },
      "location",
    );
    expect(shown?.kind).toBe("pack");
    if (shown?.kind !== "pack") return;
    expect(shown.contactFileId).toBeNull();
    expect(shown.pictures.map((p) => p.key)).toEqual(["hero", "view-1", "view-3"]);
    expect(reviewPicture(shown)).toBe("hero-file");
  });

  it("shows a locked pack's approved views and its contact sheet once stored", () => {
    const detail: Detail = {
      stage: "ready",
      looks: [look],
      sheets: [sheet(1, { status: "accepted", fileId: "contact" })],
      packViews: [view(1, "accepted", "f1"), view(2, "superseded", "f2")],
    };
    const shown = toReviewSheet(detail, "prop");
    if (shown?.kind !== "pack") throw new Error("not a pack");
    expect(shown.pictures.map((p) => p.key)).toEqual(["hero", "view-1"]);
    expect(reviewPicture(shown)).toBe("contact");
  });
});
