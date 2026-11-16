/**
 * What a block revision is asked to do, stored on the review row that requested it. Written by a
 * block review (the user's note) or by a take review routed to "revise" (confirmed Video Review
 * issues, timed notes and the keep list); read by the Block Revision job.
 */
import { z } from "zod";

export const timedNoteSchema = z.object({
  fromS: z.number().min(0),
  toS: z.number().min(0),
  text: z.string().trim().min(1).max(2000),
});

export const observedIssueSchema = z.object({
  issue_id: z.string().min(1).max(40),
  cause: z.string().max(40),
  kind: z.string().max(40),
  severity: z.string().max(20),
  window: z.string().max(20),
  planned: z.string().max(2000),
  observed: z.string().max(2000),
  label: z.string().max(500),
});

export const revisionRequestSchema = z.object({
  source: z.enum(["block_review", "take_review"]),
  note: z.string().trim().max(2000).optional(),
  timedNotes: z.array(timedNoteSchema).max(20).default([]),
  observedIssues: z.array(observedIssueSchema).max(50).default([]),
  keep: z
    .array(z.object({ window: z.string().max(20), what: z.string().max(500) }))
    .max(20)
    .default([]),
  takeId: z.string().uuid().optional(),
  regenerate: z.boolean().default(false),
});

export type TimedNote = z.infer<typeof timedNoteSchema>;
export type ObservedIssue = z.infer<typeof observedIssueSchema>;
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;
