import { z } from "zod";
import {
  SAMPLE_MODEL,
  SCRIPT_ISSUE_CATEGORIES,
  SCRIPT_ISSUE_SEVERITIES,
  type ScriptChangeSummaryItem,
  type ScriptCheckIssue,
  type ScriptLineEdit,
} from "@/server/damis";
import type { scriptVersion, ScriptSource, ScriptStatus } from "@/server/db/schema";

export type ScriptVersionRow = typeof scriptVersion.$inferSelect;

/**
 * What `script_version.dami_notes` holds: the dami output that is not the script text, plus the
 * user-readable failure of a failed version.
 */
export type ScriptDamiNotes = {
  title?: string | null;
  logline?: string | null;
  /** Writer notes. */
  notes?: string[];
  /** Checker result (uploads). */
  check?: { verdict: "ready" | "needs_attention"; summary: string; issues: ScriptCheckIssue[] };
  /** Reviser result. */
  changeSummary?: ScriptChangeSummaryItem[];
  edits?: ScriptLineEdit[];
  failure?: string | null;
};

const issueSchema = z.object({
  severity: z.enum(SCRIPT_ISSUE_SEVERITIES),
  category: z.enum(SCRIPT_ISSUE_CATEGORIES),
  quote: z.string(),
  explanation: z.string(),
  suggestion: z.string(),
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
  failure: z.string().nullish(),
});

/** Reads stored notes defensively (old or foreign shapes read as empty). */
export function readNotes(value: unknown): ScriptDamiNotes {
  const parsed = notesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
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
  /** Writer notes, the reviser's change summary, or the checker's summary. */
  notes: string[];
  findings: ScriptCheckIssue[] | null;
  checkVerdict: "ready" | "needs_attention" | null;
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
      (notes.check ? [notes.check.summary] : []),
    findings: notes.check?.issues ?? null,
    checkVerdict: notes.check?.verdict ?? null,
    failure: row.status === "failed" ? (notes.failure ?? null) : null,
    isSample: model === SAMPLE_MODEL,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}
