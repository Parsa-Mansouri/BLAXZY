import { stageViews, type ProjectStageKey, type StageStatus } from "@/lib/stages";
import { getPreProductionNavigator, type PreProductionNavigator } from "@/server/assets";
import { getProductionNavigator, type ProductionNavigator } from "@/server/production";
import { canOpenStage, getProjectForUser } from "@/server/projects";
import { type AssetKindKey, assetHref } from "./asset-kinds";
import { loadBackgroundStatus } from "./background-status";
import { blockHref, clipHref } from "./production-routes";

/** A row's status in the navigator: what failed, what waits for the user, what is being made. */
export interface NavigatorStatus {
  failed: number;
  toReview: number;
  rendering: boolean;
}

export interface NavigatorStage {
  key: ProjectStageKey;
  label: string;
  status: StageStatus;
  /** Present on stages that can be opened. */
  href?: string;
  /** Present on locked stages, e.g. "Finish Script first". */
  lockedHint?: string;
}

/** Something being made, named in "Now Rendering". */
export interface NavigatorBusyItem {
  key: string;
  name: string;
  href: string;
}

/** The film navigator: everything the in-film sidebar shows, in one read. */
export interface NavigatorView {
  projectId: string;
  title: string;
  stages: NavigatorStage[];
  /** Detection or sectioning runs after the accepted script, or it failed. */
  script: { working: boolean; failed: boolean };
  /** Null while Pre-production is locked. Kinds that have active assets, in display order. */
  preProduction: { kinds: ({ kind: AssetKindKey } & NavigatorStatus)[] } | null;
  /** Null while Production is locked. */
  production: { shots: NavigatorStatus; clips: NavigatorStatus; finished: boolean } | null;
  /** The first things being made (assets, then shots) and how many more there are. */
  busy: { items: NavigatorBusyItem[]; more: number };
  /** Any work is running: the navigator polls faster. */
  working: boolean;
  /** Changes whenever anything shown changes. */
  signature: string;
}

/** How many busy items "Now Rendering" names in all. */
const BUSY_SHOWN = 5;

const status = (s: { failed: number; toReview: number; rendering: number }): NavigatorStatus => ({
  failed: s.failed,
  toReview: s.toReview,
  rendering: s.rendering > 0,
});

function busyItems(
  projectId: string,
  pre: PreProductionNavigator | null,
  production: ProductionNavigator | null,
): NavigatorView["busy"] {
  const assets: NavigatorBusyItem[] = (pre?.busy ?? []).map((a) => ({
    key: `asset:${a.id}`,
    name: a.name,
    href: assetHref(projectId, a.id),
  }));
  const shots: NavigatorBusyItem[] = (production?.busy ?? []).map((b) => ({
    key: `shot:${b.lineageId}`,
    name: b.title ?? `Shot ${b.orderIndex + 1}`,
    // A shot being prepared is reviewed in the shots list; a rendering one on its clip page.
    href:
      b.stage === "preparing"
        ? blockHref(projectId, b.lineageId)
        : clipHref(projectId, b.lineageId),
  }));
  const all = [...assets, ...shots];
  const items = all.slice(0, BUSY_SHOWN);
  const total = all.length + (pre?.moreBusy ?? 0) + (production?.moreBusy ?? 0);
  return { items, more: Math.max(0, total - items.length) };
}

/**
 * The film navigator of the user's project, or null when it is missing or not theirs. Reads only
 * the stages that are open: pre-production's asset states while Pre-production is open, the
 * shots' stages while Production is open, and the sectioning state for Script.
 */
export async function loadNavigator(
  projectId: string,
  userId: string,
): Promise<NavigatorView | null> {
  const project = await getProjectForUser(projectId, userId);
  if (!project) return null;
  const preOpen = canOpenStage(project, "pre_production");
  const productionOpen = canOpenStage(project, "production");
  const [background, pre, production] = await Promise.all([
    loadBackgroundStatus(project.id, userId, null),
    preOpen ? getPreProductionNavigator(project.id, userId) : Promise.resolve(null),
    productionOpen ? getProductionNavigator(project.id, userId) : Promise.resolve(null),
  ]);
  const stages = stageViews(project.stage, project.id).map(
    ({ key, label, status: stageStatus, href, lockedHint }): NavigatorStage => ({
      key,
      label,
      status: stageStatus,
      ...(href ? { href } : {}),
      ...(lockedHint ? { lockedHint } : {}),
    }),
  );
  const script = {
    working: background?.state === "running",
    failed: background?.state === "failed",
  };
  const preProduction = pre
    ? { kinds: pre.kinds.map((k) => ({ kind: k.kind, ...status(k) })) }
    : null;
  const productionView = production
    ? {
        shots: status(production.shots),
        clips: status(production.clips),
        finished: production.finished,
      }
    : null;
  const busy = busyItems(project.id, pre, production);
  const working =
    script.working ||
    busy.items.length > 0 ||
    Boolean(preProduction?.kinds.some((k) => k.rendering)) ||
    Boolean(productionView && (productionView.shots.rendering || productionView.clips.rendering));
  const view: Omit<NavigatorView, "signature"> = {
    projectId: project.id,
    title: project.title,
    stages,
    script,
    preProduction,
    production: productionView,
    busy,
    working,
  };
  return { ...view, signature: JSON.stringify(view) };
}
