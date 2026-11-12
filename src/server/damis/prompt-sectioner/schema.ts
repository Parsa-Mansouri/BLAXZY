import { z } from "zod";
import { ASSET_KINDS } from "@/server/db/schema";
import { assetNameSchema, assetRefSchema } from "../shared/asset-ref";
import { projectStyleSchema } from "../shared/style";

/** Maximum length of one generation unit, in seconds. */
export const MAX_BLOCK_SECONDS = 15;

export const sectionerAssetSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  /** The asset's real name, which is its id within its kind (the ref is `kind:Name`). */
  name: assetNameSchema,
  description: z.string().max(4000).nullish(),
});

export const lineRangeSchema = z
  .object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .refine((r) => r.startLine <= r.endLine, { message: "startLine must not be after endLine" });

export const promptSectionerInputSchema = z
  .object({
    style: projectStyleSchema,
    content: z.string().trim().min(1).max(600_000),
    assets: z.array(sectionerAssetSchema).max(500),
    /** The lines to cut in this call (default: the whole script). See `sectionScript`. */
    range: lineRangeSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const lineCount = input.content.replace(/\r\n?/g, "\n").split("\n").length;
    if (input.range && input.range.endLine > lineCount) {
      ctx.addIssue({
        code: "custom",
        path: ["range", "endLine"],
        message: `range ends after the last line (${lineCount})`,
      });
    }
  });

const modelBlockSchema = z.object({
  title: z.string().trim().min(1).max(80).describe("Short English label for the block."),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  prompt: z.string().trim().min(1).max(6000).describe("The standalone video prompt."),
  durationSeconds: z.number().int().min(1).max(MAX_BLOCK_SECONDS),
  assetRefs: z
    .array(assetRefSchema)
    .describe("The kind:Name of every asset tagged in the prompt, in order of first appearance."),
});

/** What the model returns for one range. */
export const promptSectionerModelOutputSchema = z.object({
  blocks: z.array(modelBlockSchema).min(1),
});

export type PromptSectionerInput = z.input<typeof promptSectionerInputSchema>;
export type SectionerAsset = z.output<typeof sectionerAssetSchema>;
export type PromptSectionerModelBlock = z.output<typeof modelBlockSchema>;

/** One generation block of the dami's public result. */
export type PromptBlockDraft = {
  title: string;
  /** The script lines this block covers, verbatim. */
  scriptExcerpt: string;
  prompt: string;
  durationSeconds: number;
  /** `kind:Name` of each asset in the block. */
  assetRefs: string[];
  /** 1-based inclusive line range in the script (CR/LF normalised). */
  startLine: number;
  endLine: number;
};

export type PromptSectionerOutput = { blocks: PromptBlockDraft[] };
