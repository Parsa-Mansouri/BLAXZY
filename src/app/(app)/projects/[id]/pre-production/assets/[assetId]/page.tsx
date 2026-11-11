import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  getAssetDetail,
  MAX_ASSET_DESCRIPTION_LENGTH,
  MAX_ASSET_NAME_LENGTH,
  MAX_GUIDED_ANSWER_LENGTH,
  MAX_LOOK_PROMPT_LENGTH,
  MAX_REVIEW_NOTE_LENGTH,
} from "@/server/assets";
import { requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import { ASSET_QUESTIONS, LOOK_ISSUE_LIST, SHEET_ISSUE_LIST } from "@/server/damis";
import { quoteGeneration } from "@/server/generation";
import { ASSET_KIND_LABELS } from "../../../_lib/asset-kinds";
import { loadProject } from "../../../_lib/load-project";
import { loadProjectForStage } from "../../../_lib/load-stage";
import { AssetScreen } from "./_components/asset-screen";
import { kindSlug } from "./_lib/asset-view";
import { parseIntent } from "./_lib/intent";

type Params = Promise<{ id: string; assetId: string }>;

/** "other asset" → "Other Asset". */
const titleCase = (words: string) => words.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

/** The asset, when it belongs to this project; shared by the metadata and the page. */
const loadDetail = cache(async (projectId: string, assetId: string) => {
  const user = await requireUser();
  const detail = await getAssetDetail(assetId, user.id);
  return detail && detail.asset.projectId === projectId ? detail : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, assetId } = await params;
  const project = await loadProject(id);
  const detail = await loadDetail(project.id, assetId).catch(() => null);
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
  const project = await loadProjectForStage(id, "pre_production");
  const user = await requireUser();
  const detail = await loadDetail(project.id, assetId);
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
      }}
      orientation={style?.orientation ?? "landscape"}
      prices={{ look: lookPrice, sheet: sheetPrice }}
      balance={balance}
      questions={ASSET_QUESTIONS[asset.kind]}
      lookIssues={LOOK_ISSUE_LIST.map(({ code, label, hint }) => ({ code, label, hint }))}
      sheetIssues={SHEET_ISSUE_LIST.map(({ code, label, hint }) => ({ code, label, hint }))}
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
