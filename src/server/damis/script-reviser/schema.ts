import { z } from "zod";
import { projectStyleSchema } from "../shared/style";
import { SCRIPT_ISSUE_CODES } from "./issues";

/** Mirror of `ReviewComment` in the database schema. */
export const reviewCommentSchema = z.object({
  quote: z.string().min(1).max(5000),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  note: z.string().trim().min(1).max(4000),
});

export const scriptReviewSchema = z
  .object({
    issueCodes: z.array(z.enum(SCRIPT_ISSUE_CODES)).max(SCRIPT_ISSUE_CODES.length).default([]),
    note: z.string().trim().max(8000).optional(),
    comments: z.array(reviewCommentSchema).max(100).default([]),
  })
  .refine((r) => r.issueCodes.length > 0 || (r.note ?? "").length > 0 || r.comments.length > 0, {
    message: "a review needs at least one issue code, a note or a comment",
  });

export const scriptReviserInputSchema = z.object({
  style: projectStyleSchema,
  /** The script version being revised. */
  content: z.string().trim().min(1).max(600_000),
  review: scriptReviewSchema,
});

const lineEditSchema = z.object({
  startLine: z.number().int().min(1).describe("First line replaced (1-based, inclusive)."),
  endLine: z.number().int().min(1).describe("Last line replaced (inclusive)."),
  replacement: z
    .string()
    .describe("The new text for these lines, without line numbers. Empty string deletes them."),
});

const changeSummaryItemSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1)
    .describe('What this answers: an issue code, "note", "comment N", or "ripple".'),
  change: z.string().trim().min(1).max(600).describe("What was changed, in English."),
});

/** What the model returns: line edits, applied by the system. */
export const scriptReviserModelOutputSchema = z.object({
  edits: z.array(lineEditSchema).min(1),
  changeSummary: z.array(changeSummaryItemSchema).min(1),
});

export type ScriptLineEdit = z.output<typeof lineEditSchema>;
export type ScriptChangeSummaryItem = z.output<typeof changeSummaryItemSchema>;
export type ScriptReviserInput = z.input<typeof scriptReviserInputSchema>;

/** The dami's public result. */
export type ScriptReviserOutput = {
  /** The full revised script. */
  content: string;
  changeSummary: ScriptChangeSummaryItem[];
  /** The edits as applied, against the input's line numbers (for a diff view). */
  edits: ScriptLineEdit[];
};
