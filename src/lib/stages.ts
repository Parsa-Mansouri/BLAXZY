/**
 * The four guided stages of a film project, in order. Pure data with no server imports, so
 * both server and client components (and the stage-building code) can use it.
 */
export const PROJECT_STAGES = [
  { key: "style", label: "Style", summary: "Choose the look and feel of the film." },
  { key: "script", label: "Script", summary: "Write or upload the story, then refine it." },
  {
    key: "pre_production",
    label: "Pre-production",
    summary: "Approve the characters, places and shots.",
  },
  {
    key: "production",
    label: "Production",
    summary: "Generate every clip, ready for your editor.",
  },
] as const;

export type ProjectStageKey = (typeof PROJECT_STAGES)[number]["key"];

/** URL slug of each stage's route, `/projects/[id]/<slug>`. */
export const STAGE_SLUGS: Record<ProjectStageKey, string> = {
  style: "style",
  script: "script",
  pre_production: "pre-production",
  production: "production",
};

/** Route of a stage inside a project, e.g. `stageHref("abc", "script")` is `/projects/abc/script`. */
export function stageHref(projectId: string, stage: ProjectStageKey): string {
  return `/projects/${projectId}/${STAGE_SLUGS[stage]}`;
}

/** Route of the project's current stage; a finished project opens at its last stage. */
export function currentStageHref(projectId: string, stage: string): string {
  const key = KEYS.includes(stage)
    ? (stage as ProjectStageKey)
    : stage === "done"
      ? "production"
      : "style";
  return stageHref(projectId, key);
}

export type StageStatus = "done" | "current" | "upcoming" | "locked";

export interface StageView {
  key: ProjectStageKey;
  label: string;
  summary: string;
  status: StageStatus;
  /** Route of the stage; present on stages that can be opened (done and current). */
  href?: string;
  /** Present on locked stages, e.g. "Finish Script first". */
  lockedHint?: string;
}

const KEYS: readonly string[] = PROJECT_STAGES.map((s) => s.key);

/** Position of a stored stage; "done" is past the last stage, unknown values count as the first. */
function stageIndex(stage: string): number {
  if (stage === "done") return PROJECT_STAGES.length;
  const index = KEYS.indexOf(stage);
  return index === -1 ? 0 : index;
}

/** Human label of a stored stage value ("pre_production" becomes "Pre-production"). */
export function stageLabel(stage: string): string {
  if (stage === "done") return "Finished";
  return PROJECT_STAGES.find((s) => s.key === stage)?.label ?? "Style";
}

/** "Step 2 of 4", or "Finished" once every stage is done. */
export function stageStep(stage: string): string {
  const index = stageIndex(stage);
  if (index >= PROJECT_STAGES.length) return "Finished";
  return `Step ${index + 1} of ${PROJECT_STAGES.length}`;
}

/** Earlier stages are done, the current one is current, all later ones are locked. */
export function stageViews(stage: string, projectId?: string): StageView[] {
  const current = stageIndex(stage);
  return PROJECT_STAGES.map((s, i): StageView => {
    const href = projectId ? stageHref(projectId, s.key) : undefined;
    if (i < current) return { ...s, status: "done", href };
    if (i === current) return { ...s, status: "current", href };
    const previous = PROJECT_STAGES[i - 1];
    return {
      ...s,
      status: "locked",
      lockedHint: previous ? `Finish ${previous.label} first` : undefined,
    };
  });
}
