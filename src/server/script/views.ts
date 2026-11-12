import { z } from "zod";
import {
  SAMPLE_MODEL,
  SCRIPT_ISSUE_CATEGORIES,
  SCRIPT_ISSUE_SEVERITIES,
  submitOutlineSchema,
  type ScriptChangeSummaryItem,
  type ScriptCheckIssue,
  type ScriptLineEdit,
  type SubmitOutline,
} from "@/server/damis";
import type { scriptVersion, ScriptSource, ScriptStatus } from "@/server/db/schema";

export type ScriptVersionRow = typeof scriptVersion.$inferSelect;

export type AddedAssumption = { text: string; reason: string; sceneNumber: number };
export type ChangeLogEntry = { sceneNumber: number; change: string; addresses: string };
export type RuntimeNote = {
  estimatedSeconds: number;
  targetSeconds: number;
  toleranceSeconds: number;
  verdict: "ok" | "too_long" | "too_short";
};
export type ValidationNote = { failed: string[]; notes: string };
/** The long pipeline's progress while sequences are written (worker only). */
export type SegmentProgress = {
  nextIndex: number;
  scenes: unknown[];
  ledger: unknown;
  warnings: string[];
  assumptions: AddedAssumption[];
  runIds: string[];
};
export type EnhanceNote = {
  lookLine: string | null;
  overrides: string[];
  /** The Enhancer failed and the user's own text was kept. */
  fellBack: boolean;
};

/**
 * What `script_version.dami_notes` holds: the dami output that is not the script text, plus the
 * user-readable failure of a failed version.
 */
export type ScriptDamiNotes = {
  title?: string | null;
  logline?: string | null;
  /** Writer notes (older versions). */
  notes?: string[];
  /** Checker result (uploads). */
  check?: { verdict: "ready" | "needs_attention"; summary: string; issues: ScriptCheckIssue[] };
  /** Reviser result. */
  changeSummary?: ScriptChangeSummaryItem[];
  edits?: ScriptLineEdit[];
  /** Script Writer v0.2: shown to the user. */
  addedAssumptions?: AddedAssumption[];
  warnings?: string[];
  changeLog?: ChangeLogEntry[];
  /** Script Writer v0.2: kept for the pipeline. */
  validation?: ValidationNote;
  runtime?: RuntimeNote;
  /** Long pieces: the outline to review (in_review) or the approved one being written (pending). */
  outline?: SubmitOutline;
  /** Indexes of the outline's proposed additions the user approved. */
  approvedAdditions?: number[];
  /** The outline was approved: the version is written sequence by sequence. */
  outlineApproved?: boolean;
  /** Re-running the outline after the user asked for changes. */
  outlineFeedback?: string;
  segmentProgress?: SegmentProgress;
  /** Enhanced versions. */
  enhance?: EnhanceNote;
  failure?: string | null;
};

const issueSchema = z.object({
  severity: z.enum(SCRIPT_ISSUE_SEVERITIES),
  category: z.enum(SCRIPT_ISSUE_CATEGORIES),
  quote: z.string(),
  explanation: z.string(),
  suggestion: z.string(),
});

const assumptionSchema = z.object({
  text: z.string(),
  reason: z.string(),
  sceneNumber: z.number(),
});

const notesSchema = z.object({
  title: z.string().nullish(),
  logline: z.string().nullish(),
  notes: z.array(z.string()).optional(),
  check: z
    .object({
      verdict: z.enum(["ready", "needs_attention"]),
      summary: z.string(),
      issues: z.array(issueSchema),
    })
    .optional(),
  changeSummary: z.array(z.object({ request: z.string(), change: z.string() })).optional(),
  edits: z
    .array(z.object({ startLine: z.number(), endLine: z.number(), replacement: z.string() }))
    .optional(),
  addedAssumptions: z.array(assumptionSchema).optional(),
  warnings: z.array(z.string()).optional(),
  changeLog: z
    .array(z.object({ sceneNumber: z.number(), change: z.string(), addresses: z.string() }))
    .optional(),
  validation: z.object({ failed: z.array(z.string()), notes: z.string() }).optional(),
  runtime: z
    .object({
      estimatedSeconds: z.number(),
      targetSeconds: z.number(),
      toleranceSeconds: z.number(),
      verdict: z.enum(["ok", "too_long", "too_short"]),
    })
    .optional(),
  outline: submitOutlineSchema.optional(),
  approvedAdditions: z.array(z.number().int().min(0)).optional(),
  outlineApproved: z.boolean().optional(),
  outlineFeedback: z.string().optional(),
  segmentProgress: z
    .object({
      nextIndex: z.number().int().min(0),
      scenes: z.array(z.unknown()),
      ledger: z.unknown(),
      warnings: z.array(z.string()),
      assumptions: z.array(assumptionSchema),
      runIds: z.array(z.string()),
    })
    .optional(),
  enhance: z
    .object({
      lookLine: z.string().nullable(),
      overrides: z.array(z.string()),
      fellBack: z.boolean(),
    })
    .optional(),
  failure: z.string().nullish(),
});

/** Reads stored notes defensively (old or foreign shapes read as empty). */
export function readNotes(value: unknown): ScriptDamiNotes {
  const parsed = notesSchema.safeParse(value ?? {});
  return parsed.success ? (parsed.data as ScriptDamiNotes) : {};
}

/** The outline as the review screen shows it. */
export type OutlineView = {
  logline: string;
  canonicalNames: { characters: string[]; locations: string[]; props: string[] };
  acts: {
    act: number;
    purpose: string;
    targetSeconds: number;
    sequences: {
      id: string;
      summary: string;
      targetSeconds: number;
      scenes: {
        sceneNumber: number;
        heading: string;
        characters: string[];
        purpose: string;
        change: string;
        targetSeconds: number;
      }[];
    }[];
  }[];
  proposedAdditions: { index: number; text: string; reason: string; sceneNumbers: number[] }[];
  warnings: string[];
};

function outlineView(outline: SubmitOutline): OutlineView {
  return {
    logline: outline.logline,
    canonicalNames: outline.canonical_names,
    acts: outline.acts.map((a) => ({
      act: a.act,
      purpose: a.purpose,
      targetSeconds: a.target_seconds,
      sequences: a.sequences.map((s) => ({
        id: s.id,
        summary: s.summary,
        targetSeconds: s.target_seconds,
        scenes: s.scenes.map((sc) => ({
          sceneNumber: sc.scene_number,
          heading: `${sc.int_ext === "INT/EXT" ? "INT./EXT." : `${sc.int_ext}.`} ${sc.location.toUpperCase()} - ${sc.time_of_day}`,
          characters: sc.characters,
          purpose: sc.purpose,
          change: sc.change,
          targetSeconds: sc.target_seconds,
        })),
      })),
    })),
    proposedAdditions: outline.proposed_additions.map((p, index) => ({
      index,
      text: p.text,
      reason: p.reason,
      sceneNumbers: p.scene_numbers,
    })),
    warnings: outline.warnings,
  };
}

export type ScriptVersionView = {
  id: string;
  versionNumber: number;
  source: ScriptSource;
  status: ScriptStatus;
  content: string | null;
  brief: string | null;
  title: string | null;
  logline: string | null;
  /** Writer notes, the reviser's change summary, the writer's change log, or the checker's summary. */
  notes: string[];
  findings: ScriptCheckIssue[] | null;
  checkVerdict: "ready" | "needs_attention" | null;
  /** The Script Writer wrote it (revise mode is available for it). */
  structured: boolean;
  /** What the writer invented (shown so the user can reject one). */
  assumptions: AddedAssumption[];
  warnings: string[];
  runtime: RuntimeNote | null;
  /** An outline waiting for approval (long pieces), or null. */
  outline: OutlineView | null;
  /** Long pieces: the version is being written sequence by sequence. */
  writingSegments: boolean;
  /** Enhanced versions: the one-line look, and whether the user's own text was kept. */
  lookLine: string | null;
  enhanceFellBack: boolean;
  failure: string | null;
  isSample: boolean;
  createdAt: Date;
  decidedAt: Date | null;
};

export type ScriptVersionSummary = {
  id: string;
  versionNumber: number;
  status: ScriptStatus;
  source: ScriptSource;
  createdAt: Date;
};

/** `model` is the producing dami run's model (null when no dami produced the version). */
export function toView(row: ScriptVersionRow, model: string | null): ScriptVersionView {
  const notes = readNotes(row.damiNotes);
  const reviewOutline = notes.outline && !notes.outlineApproved && row.content === null;
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    source: row.source,
    status: row.status,
    content: row.content,
    brief: row.brief,
    title: notes.title ?? null,
    logline: notes.logline ?? null,
    notes:
      notes.notes ??
      notes.changeSummary?.map((c) => c.change) ??
      notes.changeLog?.map((c) => c.change) ??
      (notes.check ? [notes.check.summary] : []),
    findings: notes.check?.issues ?? null,
    checkVerdict: notes.check?.verdict ?? null,
    structured: row.screenplay !== null && row.screenplay !== undefined,
    assumptions: notes.addedAssumptions ?? [],
    warnings: notes.warnings ?? [],
    runtime: notes.runtime ?? null,
    outline: reviewOutline && notes.outline ? outlineView(notes.outline) : null,
    writingSegments: notes.outlineApproved === true && row.status === "pending",
    lookLine: notes.enhance?.lookLine ?? null,
    enhanceFellBack: notes.enhance?.fellBack ?? false,
    failure: row.status === "failed" ? (notes.failure ?? null) : null,
    isSample: model === SAMPLE_MODEL,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}
