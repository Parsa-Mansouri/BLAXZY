import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  getAssetDetail,
  getPreProductionOverview,
  listAssetCards,
  MAX_CARD_PAGE_SIZE,
} from "@/server/assets";
import { requireUser } from "@/server/auth";
import { SHEET_ISSUE_LIST } from "@/server/damis";
import { ASSET_KIND_LABELS } from "../../_lib/asset-kinds";
import { loadProjectForStage } from "../../_lib/load-stage";
import { ReviewPass, type ReviewItem } from "./_components/review-pass";

/** The most assets one pass walks through. */
const MAX_PASS = 500;

export default async function ReviewAllPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "pre_production");
  const user = await requireUser();
  const overview = await getPreProductionOverview(project.id, user.id);
  if (!overview) notFound();

  const back = (
    <Link
      href={`/projects/${project.id}/pre-production`}
      className="-ml-1.5 inline-flex w-fit items-center gap-0.5 rounded-control px-1.5 py-0.5 text-body text-label-2 focus-ring hover:text-label"
    >
      <ChevronLeft aria-hidden className="size-(--icon)" />
      Pre-production
    </Link>
  );

  if (overview.total === 0 || overview.ready < overview.total) {
    return (
      <div className="flex max-w-(--measure) flex-col gap-4">
        {back}
        <h2 className="text-large-title">Review All Sheets</h2>
        <p className="text-reading text-label-2">
          {overview.total === 0
            ? "There are no assets to review yet."
            : `${overview.ready} of ${overview.total} assets are ready. Finish the rest, then come back to look through every sheet.`}
        </p>
      </div>
    );
  }

  const items: ReviewItem[] = [];
  for (const { kind, one } of ASSET_KIND_LABELS) {
    // Voices are a recording, not a sheet; they are not part of the pass.
    if (kind === "voice" || !overview.kinds.some((k) => k.kind === kind)) continue;
    let cursor: string | null = null;
    do {
      const page = await listAssetCards(project.id, user.id, {
        kind,
        cursor,
        limit: MAX_CARD_PAGE_SIZE,
      });
      if (!page) break;
      for (const card of page.items) {
        if (card.stage === "ready") {
          items.push({ id: card.asset.id, name: card.asset.name, kind, kindName: one });
        }
      }
      cursor = page.nextCursor;
    } while (cursor && items.length < MAX_PASS);
  }

  const first = items[0] ? await getAssetDetail(items[0].id, user.id) : null;
  const firstSheet = first?.sheets.find((s) => s.status === "accepted");

  return (
    <ReviewPass
      projectId={project.id}
      items={items}
      firstSheet={
        items[0] && firstSheet?.fileId
          ? { sheetId: firstSheet.id, fileId: firstSheet.fileId }
          : null
      }
      issues={SHEET_ISSUE_LIST.map(({ code, label, hint }) => ({ code, label, hint }))}
      canContinue={project.stage === "pre_production"}
    />
  );
}
