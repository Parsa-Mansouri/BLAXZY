/**
 * Sample provider job ids carry the whole job state, so any process can answer for any job
 * without memory or storage: `sample_<base64url(JSON)>`.
 */
import { z } from "zod";
import { GENERATION_KINDS, GENERATION_PURPOSES } from "@/server/db/schema";

const PREFIX = "sample_";
export const MAX_LABEL_LENGTH = 120;

export const SAMPLE_OUTCOMES = ["ok", "fail", "flaky"] as const;
export type SampleOutcome = (typeof SAMPLE_OUTCOMES)[number];

const sampleJobSchema = z.object({
  v: z.literal(1),
  /** Created at, ms since epoch. */
  c: z.number().int().nonnegative(),
  /** Ready at, ms since epoch. */
  r: z.number().int().nonnegative(),
  o: z.enum(SAMPLE_OUTCOMES),
  k: z.enum(GENERATION_KINDS),
  p: z.enum(GENERATION_PURPOSES),
  a: z.enum(["16:9", "9:16"]),
  l: z.string().max(MAX_LABEL_LENGTH),
  /** Request digest (hex), the seed of the image's tints (a final's is its draft's). */
  d: z.string().regex(/^[0-9a-f]{16}$/),
  /** Video only: duration in whole seconds, resolution and sound. */
  s: z.number().int().min(1).max(15).optional(),
  q: z.enum(["480p", "1080p"]).optional(),
  n: z.boolean().optional(),
});

export type SampleJob = z.output<typeof sampleJobSchema>;

export function encodeSampleJobId(job: SampleJob): string {
  return PREFIX + Buffer.from(JSON.stringify(job), "utf8").toString("base64url");
}

/** The decoded job, or null for an id that is not a valid sample job id. */
export function decodeSampleJobId(id: string): SampleJob | null {
  if (!id.startsWith(PREFIX) || id.length > 2_000) return null;
  try {
    const json: unknown = JSON.parse(
      Buffer.from(id.slice(PREFIX.length), "base64url").toString("utf8"),
    );
    const parsed = sampleJobSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
