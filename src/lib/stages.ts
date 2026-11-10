/**
 * The four guided stages of a film project, in order. Pure data with no server imports, so
 * both server and client components (and the stage-building code) can use it.
 */
export const PROJECT_STAGES = [
  { key: "style", label: "Style", summary: "Pick the look and feel of your film." },
  { key: "script", label: "Script", summary: "Write or upload the story, then refine it." },
  {
    key: "pre_production",
    label: "Pre-production",
    summary: "Approve characters, places and shots.",
  },
  { key: "production", label: "Production", summary: "Generate and assemble the film." },
] as const;

export type ProjectStageKey = (typeof PROJECT_STAGES)[number]["key"];

export type StageStatus = "done" | "current" | "upcoming" | "locked";

export interface StageView {
  key: ProjectStageKey;
  label: string;
  summary: string;
  status: StageStatus;
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

/** Earlier stages are done, the current one is current, all later ones are locked. */
export function stageViews(stage: string): StageView[] {
  const current = stageIndex(stage);
  return PROJECT_STAGES.map((s, i): StageView => {
    if (i < current) return { ...s, status: "done" };
    if (i === current) return { ...s, status: "current" };
    const previous = PROJECT_STAGES[i - 1];
    return {
      ...s,
      status: "locked",
      lockedHint: previous ? `Finish ${previous.label} first` : undefined,
    };
  });
}
