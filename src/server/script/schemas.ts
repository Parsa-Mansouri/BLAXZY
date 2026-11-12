import { z } from "zod";
import { SCRIPT_ISSUE_CODES, WRITER_REASON_CODES } from "@/server/damis";
import { ScriptInputError } from "./errors";
import { MAX_SCRIPT_CHARS } from "./extract";

export const MAX_BRIEF_CHARS = 20_000;
export const MAX_REVIEW_NOTE_CHARS = 8_000;
export const MAX_REVIEW_COMMENTS = 100;
/** Version summaries returned by `getScriptState` (newest first). */
export const MAX_LISTED_VERSIONS = 50;

export const uuidSchema = z.uuid();

const ids = { projectId: z.string(), userId: z.string().min(1) };

export const startFromBriefSchema = z.object({
  ...ids,
  brief: z
    .string({ error: "Describe your film in a few words." })
    .trim()
    .min(1, "Describe your film in a few words.")
    .max(MAX_BRIEF_CHARS, "Keep the description under 20,000 characters."),
});

export const startFromIdeaSchema = z.object({
  ...ids,
  idea: z
    .string({ error: "Write your idea in a few words." })
    .trim()
    .min(1, "Write your idea in a few words.")
    .max(MAX_BRIEF_CHARS, "Keep the idea under 20,000 characters."),
});

export const approveOutlineSchema = z.object({
  ...ids,
  versionId: z.string(),
  approvedAdditions: z.array(z.number().int().min(0).max(200)).max(200).default([]),
});

/** Review codes: the Script Writer reason codes (generated scripts) and the reviser issue codes. */
export const REVIEW_CODES = [...new Set([...WRITER_REASON_CODES, ...SCRIPT_ISSUE_CODES])] as [
  string,
  ...string[],
];

export const startFromUploadSchema = z.object({ ...ids, fileId: z.string() });

const commentSchema = z.object({
  quote: z.string().min(1, "A comment needs the passage it refers to.").max(5000),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  note: z
    .string()
    .trim()
    .min(1, "A comment cannot be empty.")
    .max(4000, "Keep each comment under 4,000 characters."),
});

export const submitReviewSchema = z.object({
  ...ids,
  versionId: z.string(),
  decision: z.enum(["accepted", "rejected"], { error: "Choose accept or reject." }),
  issueCodes: z
    .array(z.enum(REVIEW_CODES, { error: "One of the chosen issues is not known." }))
    .max(REVIEW_CODES.length)
    .optional(),
  note: z
    .string()
    .trim()
    .max(MAX_REVIEW_NOTE_CHARS, "Keep the note under 8,000 characters.")
    .optional(),
  comments: z
    .array(commentSchema)
    .max(MAX_REVIEW_COMMENTS, "Use at most 100 comments in one review.")
    .optional(),
});

export const editAcceptedSchema = z.object({
  ...ids,
  content: z
    .string({ error: "The script cannot be empty." })
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(1, "The script cannot be empty.")
        .max(MAX_SCRIPT_CHARS, "The script is too long (more than 400,000 characters)."),
    ),
});

export const retrySchema = z.object({ ...ids, versionId: z.string() });

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ScriptInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}
