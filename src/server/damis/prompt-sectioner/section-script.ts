import { z } from "zod";
import { DamiInputError } from "../framework/errors";
import { addUsage, ZERO_USAGE, type TokenUsage } from "../framework/pricing";
import {
  runDami,
  type DamiRunContext,
  type DamiRunnerDeps,
  type DamiRunResult,
} from "../framework/runner";
import {
  lineStartOffset,
  planSegments,
  splitLines,
  type ScriptSegment,
} from "../shared/script-lines";
import { projectStyleSchema } from "../shared/style";
import { assertTiles } from "./coverage";
import { promptSectioner } from "./dami";
import { sectionerAssetSchema, type PromptBlockDraft, type PromptSectionerOutput } from "./schema";

/** ~5,000 characters is roughly 2-3 screenplay pages: about 8-15 blocks per call. */
export const DEFAULT_SEGMENT_CHARS = 5000;

export const sectionScriptInputSchema = z.object({
  style: projectStyleSchema,
  content: z.string().trim().min(1).max(600_000),
  assets: z.array(sectionerAssetSchema).max(500),
});

export type SectionScriptInput = z.input<typeof sectionScriptInputSchema>;

export type SectionedBlock = PromptBlockDraft & {
  /** 0-based story order across the whole script. */
  orderIndex: number;
  /** Character offsets of the excerpt in the CR/LF-normalised script. */
  start: number;
  end: number;
};

export type SectionScriptResult = {
  blocks: SectionedBlock[];
  segments: ScriptSegment[];
  /** The model the runs used. */
  model: string;
  /** One dami run per segment, in segment order. */
  runIds: string[];
  usage: TokenUsage;
  /** Null when any run has no confirmed price. */
  costUsd: number | null;
};

export type SectionScriptOptions = { maxSegmentChars?: number };

/**
 * Deterministic stitching: segment results in segment order, blocks in their order, verified to
 * tile the whole script.
 */
export function stitchSegments(
  content: string,
  results: Array<{ segment: ScriptSegment; output: PromptSectionerOutput }>,
): SectionedBlock[] {
  const lines = splitLines(content);
  const ordered = [...results].sort((a, b) => a.segment.index - b.segment.index);
  const blocks = ordered.flatMap((r) => r.output.blocks);
  assertTiles(blocks, lines.length);
  return blocks.map((block, orderIndex) => {
    const start = lineStartOffset(lines, block.startLine);
    return { ...block, orderIndex, start, end: start + block.scriptExcerpt.length };
  });
}

/**
 * Sections a whole script: plans scene-aligned segments, runs the prompt-sectioner dami once per
 * segment (each with bounded output, each its own dami_run), and stitches the blocks. The first
 * segment runs alone so it writes the prompt cache (system prompt + numbered script); the rest
 * then run in parallel, bounded by the process-wide Claude concurrency limit, and read it.
 */
export async function sectionScript(
  input: SectionScriptInput,
  ctx: DamiRunContext = {},
  deps: DamiRunnerDeps = {},
  options: SectionScriptOptions = {},
): Promise<SectionScriptResult> {
  const parsed = sectionScriptInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DamiInputError(
      promptSectioner.key,
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const { data } = parsed;
  const segments = planSegments(data.content, options.maxSegmentChars ?? DEFAULT_SEGMENT_CHARS);

  const runSegment = (segment: ScriptSegment) =>
    runDami(
      promptSectioner,
      { ...data, range: { startLine: segment.startLine, endLine: segment.endLine } },
      ctx,
      deps,
    );

  const [first, ...rest] = segments;
  if (!first) throw new Error("planSegments returned no segments");
  const results: Array<DamiRunResult<PromptSectionerOutput>> = [await runSegment(first)];
  const settled = await Promise.allSettled(rest.map(runSegment));
  for (const outcome of settled) {
    if (outcome.status === "rejected") throw outcome.reason;
    results.push(outcome.value);
  }

  const blocks = stitchSegments(
    data.content,
    results.map((r, i) => ({ segment: segments[i] as ScriptSegment, output: r.output })),
  );
  const usage = results.reduce((sum, r) => addUsage(sum, r.usage), ZERO_USAGE);
  const costs = results.map((r) => r.costUsd);
  const costUsd = costs.some((c) => c === null)
    ? null
    : Math.round(costs.reduce<number>((sum, c) => sum + (c ?? 0), 0) * 1_000_000) / 1_000_000;
  const model = results[0]?.model ?? "";
  return { blocks, segments, model, runIds: results.map((r) => r.runId), usage, costUsd };
}
