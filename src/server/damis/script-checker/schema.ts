import { z } from "zod";
import { projectStyleSchema } from "../shared/style";

export const SCRIPT_ISSUE_SEVERITIES = ["blocker", "major", "minor"] as const;
export type ScriptIssueSeverity = (typeof SCRIPT_ISSUE_SEVERITIES)[number];

export const SCRIPT_ISSUE_CATEGORIES = [
  "duration",
  "filmability",
  "format",
  "continuity",
  "structure",
  "character",
  "dialogue",
  "project_fit",
  "safety",
  "other",
] as const;
export type ScriptIssueCategory = (typeof SCRIPT_ISSUE_CATEGORIES)[number];

export const scriptCheckerInputSchema = z.object({
  style: projectStyleSchema,
  /** The uploaded script text. */
  content: z.string().trim().min(1).max(600_000),
});

export const scriptCheckIssueSchema = z.object({
  severity: z.enum(SCRIPT_ISSUE_SEVERITIES),
  category: z.enum(SCRIPT_ISSUE_CATEGORIES),
  quote: z
    .string()
    .max(400)
    .describe(
      "Verbatim passage from the script showing the problem, or an empty string for whole-script issues.",
    ),
  explanation: z.string().trim().min(1).max(800).describe("Why it is a problem, in English."),
  suggestion: z.string().trim().min(1).max(600).describe("How to fix it, in English."),
});

export const scriptCheckerOutputSchema = z.object({
  verdict: z.enum(["ready", "needs_attention"]),
  summary: z.string().trim().min(1).max(1200),
  issues: z.array(scriptCheckIssueSchema).max(40),
});

export type ScriptCheckerInput = z.input<typeof scriptCheckerInputSchema>;
export type ScriptCheckIssue = z.output<typeof scriptCheckIssueSchema>;
export type ScriptCheckerOutput = z.output<typeof scriptCheckerOutputSchema>;
