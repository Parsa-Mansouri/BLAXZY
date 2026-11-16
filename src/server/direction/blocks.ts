/**
 * From the Director's written blocks to the rows `replaceBlocks` stores (pure): the title, the
 * script excerpt, the prompt in tag form with its ordered asset refs, the duration and the
 * Director's own data for the block. The raw `prompt_text` (with `@char_1` ids) stays in
 * `direction`; the stored `prompt` carries `[kind:Name]` tags so renames and merges rewrite it
 * like any block prompt, and Production binds the tags to `<<<image_N>>>` tokens.
 */
import {
  blockExcerpts,
  formatAssetRef,
  isVoiceRef,
  tagAssetIds,
  type AssetBinding,
  type DirectorBlock,
} from "@/server/damis";
import type { DirectedBlock } from "@/server/blocks";
import type { DirectionBinding } from "./context";

export function bindingsMap(bindings: readonly DirectionBinding[]): Map<string, AssetBinding> {
  return new Map(
    bindings.map((b) => [b.id, { kind: b.kind, name: b.name, reference: b.reference }]),
  );
}

/** The names of the assets a block's ids stand for, for showing the direction in plain words. */
function assetNames(bindings: readonly DirectionBinding[]): Record<string, string> {
  return Object.fromEntries(bindings.map((b) => [b.id, b.name]));
}

export function directedBlocks(input: {
  blocks: readonly DirectorBlock[];
  script: string;
  bindings: readonly DirectionBinding[];
  /** The dami run that wrote each block (parallel to `blocks`). */
  runIds: readonly (string | undefined)[];
}): DirectedBlock[] {
  const map = bindingsMap(input.bindings);
  const excerpts = blockExcerpts(
    input.script,
    input.blocks.map((b) => b.script_coverage),
  );
  return input.blocks.map((block, i) => {
    const tagged = tagAssetIds(block.prompt_text, map);
    // Assets the Director lists for the block but the prompt does not tag come after the tagged
    // ones (a voice-only character has no reference and is left out).
    const listed = [...block.assets.characters, ...block.assets.locations, ...block.assets.props]
      .map((id) => map.get(id))
      .flatMap((b) => (b && b.reference !== false ? [formatAssetRef(b.kind, b.name)] : []));
    const assetRefs = [...new Set([...tagged.assetRefs, ...listed])].filter((r) => !isVoiceRef(r));
    return {
      title: block.scene_heading.trim() || `Block ${block.block_id}`,
      scriptExcerpt: excerpts[i] || block.scene_heading || `Block ${block.block_id}`,
      prompt: tagged.prompt,
      durationSeconds: block.duration_s,
      assetRefs,
      orderIndex: block.block_id - 1,
      ...(input.runIds[i] ? { damiRunId: input.runIds[i] } : {}),
      direction: { ...block, asset_names: assetNames(input.bindings) },
    };
  });
}
