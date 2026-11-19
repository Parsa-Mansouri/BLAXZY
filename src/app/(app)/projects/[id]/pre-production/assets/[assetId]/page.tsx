import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import {
  AssetInputError,
  fieldsToConfirm,
  getAssetDetail,
  MAX_ASSET_DESCRIPTION_LENGTH,
  MAX_ASSET_NAME_LENGTH,
  MAX_GUIDED_ANSWER_LENGTH,
  MAX_LOOK_PROMPT_LENGTH,
  MAX_REVIEW_NOTE_LENGTH,
  packKindOf,
  type Asset,
} from "@/server/assets";
import { requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import {
  AI_DECIDES,
  DESIGNER_CATALOGS,
  designerFor,
  getReviewCatalog,
  MAX_DESIGN_REFERENCES,
  REFERENCE_ROLES,
} from "@/server/damis/light";
import { quoteGeneration } from "@/server/generation";
import { ASSET_KIND_LABELS } from "../../../_lib/asset-kinds";
import { loadProject } from "../../../_lib/load-project";
import { loadProjectForStage } from "../../../_lib/load-stage";
import { characterSheetCatalog, packSheetCatalog } from "../../_lib/sheet-catalogs";
import { AssetScreen } from "./_components/asset-screen";
import { kindSlug } from "./_lib/asset-view";
import type { DesignerInfo } from "./_lib/designer-view";
import { parseIntent } from "./_lib/intent";

type Params = Promise<{ id: string; assetId: string }>;

/** Rejected images in a row before the "describe it exactly" hint, when the catalog says none. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** The designer that draws this kind of asset, as plain data for the screen (null for voices). */
function designerInfo(kind: Asset["kind"]): DesignerInfo | null {
  const key = designerFor(kind);
  if (!key) return null;
  const catalog = getReviewCatalog(DESIGNER_CATALOGS[key]);
  return {
    key,
    maxAttempts: catalog.maxAttemptsBeforeSuggestion ?? DEFAULT_MAX_ATTEMPTS,
    attemptMessage: catalog.attemptMessage?.en ?? null,
    roles: REFERENCE_ROLES[key],
    maxReferences: MAX_DESIGN_REFERENCES,
    aiDecides: AI_DECIDES,
  };
}

/** "other asset" → "Other Asset". */
const titleCase = (words: string) => words.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

/** The signed-in user's asset (its project is checked by the caller); shared by the metadata and the page. */
const loadDetail = cache(async (assetId: string) => {
  const user = await requireUser();
  return getAssetDetail(assetId, user.id);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, assetId } = await params;
  const project = await loadProject(id);
  // Only "stage closed" becomes an untitled page (the page itself gates it; a missing or foreign
  // asset is already null); framework errors and anything unexpected propagate.
  const found = await loadDetail(assetId).catch((err: unknown) => {
    unstable_rethrow(err);
    if (err instanceof AssetInputError) return null;
    throw err;
  });
  const detail = found?.asset.projectId === project.id ? found : null;
  return { title: detail ? `${detail.asset.name} · ${project.title} · BLAXZY` : undefined };
}

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, assetId } = await params;
  const { open } = await searchParams;
  // The project (and its stage gate) and the asset are read side by side; loadDetail starts with
  // requireUser, so nothing is read for a signed-out visitor.
  const [project, found] = await Promise.all([
    loadProjectForStage(id, "pre_production"),
    loadDetail(assetId),
  ]);
  const user = await requireUser();
  const detail = found?.asset.projectId === project.id ? found : null;
  if (!detail) notFound();

  const { asset } = detail;
  const style = project.style;
  const voice = asset.kind === "voice";
  const [lookPrice, sheetPrice, balance] = await Promise.all([
    style && !voice
      ? quoteGeneration({ purpose: "asset_look", style }).then((q) => q.priceCredits)
      : null,
    style && !voice
      ? quoteGeneration({ purpose: "asset_sheet", style }).then((q) => q.priceCredits)
      : null,
    getBalance(user.id),
  ]);
  const kindLabel = ASSET_KIND_LABELS.find((k) => k.kind === asset.kind);
  const latest = detail.looks[0];
  const pack = voice ? null : packKindOf(asset.kind);

  return (
    <AssetScreen
      projectId={project.id}
      asset={{
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        description: asset.description,
        removed: asset.status !== "active",
      }}
      kindName={titleCase(kindLabel?.one ?? "asset")}
      category={{
        href: `/projects/${project.id}/pre-production/${kindSlug(asset.kind)}`,
        label: kindLabel?.plural ?? "Assets",
      }}
      versions={{
        stage: detail.stage,
        busy: detail.busy,
        looks: detail.looks,
        sheets: detail.sheets,
        packViews: detail.packViews,
      }}
      design={{
        waitingFor: detail.waitingFor,
        rejectedInARow: detail.rejectedInARow,
        toConfirm: latest?.status === "in_review" ? fieldsToConfirm(latest.spec) : [],
      }}
      designer={designerInfo(asset.kind)}
      orientation={style?.orientation ?? "landscape"}
      prices={{ look: lookPrice, sheet: sheetPrice }}
      balance={balance}
      questions={detail.questions}
      sheetCatalog={voice ? null : pack ? packSheetCatalog(pack) : characterSheetCatalog()}
      pack={
        pack
          ? {
              kind: pack,
              views: detail.packViews,
              lockGate: detail.lockGate,
              dnaCard: detail.dnaCard,
            }
          : null
      }
      limits={{
        prompt: MAX_LOOK_PROMPT_LENGTH,
        answer: MAX_GUIDED_ANSWER_LENGTH,
        note: MAX_REVIEW_NOTE_LENGTH,
        name: MAX_ASSET_NAME_LENGTH,
        description: MAX_ASSET_DESCRIPTION_LENGTH,
      }}
      intent={parseIntent(open)}
    />
  );
}
