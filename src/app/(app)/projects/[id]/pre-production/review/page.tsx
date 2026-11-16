import { notFound } from "next/navigation";
import {
  getAssetDetail,
  getPreProductionOverview,
  listAssetCards,
  MAX_CARD_PAGE_SIZE,
  MAX_REVIEW_NOTE_LENGTH,
  packKindOf,
  type AssetStage,
} from "@/server/assets";
import { requireUser } from "@/server/auth";
import { ASSET_KIND_LABELS } from "../../_lib/asset-kinds";
import { loadProjectForStage } from "../../_lib/load-stage";
import { characterSheetCatalog } from "../_lib/sheet-catalogs";
import { toReviewSheet, type ReviewSheet } from "./_lib/review-sheet";
import { SheetsReview, type ReviewItem, type ReviewStatus } from "./_components/sheets-review";

/** The most assets one review lists. */
const MAX_ITEMS = 500;

/** Stages that have a sheet to look at, and how the review shows them. */
const LISTED: Partial<Record<AssetStage, ReviewStatus>> = {
  ready: "accepted",
  sheet_review: "todo",
  building_sheet: "back",
};

export default async function ReviewSheetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "pre_production");
  const user = await requireUser();
  const overview = await getPreProductionOverview(project.id, user.id);
  if (!overview) notFound();

  const items: ReviewItem[] = [];
  let notReady = 0;
  for (const { kind, plural } of ASSET_KIND_LABELS) {
    if (!overview.kinds.some((k) => k.kind === kind)) continue;
    let cursor: string | null = null;
    do {
      const page = await listAssetCards(project.id, user.id, {
        kind,
        cursor,
        limit: MAX_CARD_PAGE_SIZE,
      });
      if (!page) break;
      for (const card of page.items) {
        // Voices are a recording, not a sheet: they count only while not ready.
        const status = kind === "voice" ? undefined : LISTED[card.stage];
        if (status) {
          items.push({
            id: card.asset.id,
            name: card.asset.name,
            kind,
            group: plural,
            status,
            pack: packKindOf(kind) !== null,
          });
        } else if (card.stage !== "ready") {
          notReady += 1;
        }
      }
      cursor = page.nextCursor;
    } while (cursor && items.length < MAX_ITEMS);
  }

  // Open on the first sheet waiting for the user, and read its sheet now.
  const first = items.find((i) => i.status === "todo") ?? items[0] ?? null;
  let firstSheet: ReviewSheet | null = null;
  if (first && first.status !== "back") {
    const detail = await getAssetDetail(first.id, user.id);
    firstSheet = detail ? toReviewSheet(detail, packKindOf(detail.asset.kind)) : null;
  }

  return (
    <SheetsReview
      projectId={project.id}
      items={items}
      initialId={first?.id ?? null}
      initialSheet={firstSheet}
      notReady={notReady}
      characterCatalog={characterSheetCatalog()}
      maxNote={MAX_REVIEW_NOTE_LENGTH}
      moved={project.stage !== "pre_production"}
    />
  );
}
