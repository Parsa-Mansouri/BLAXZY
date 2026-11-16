/**
 * Preparing a block is code: the prompt the Director wrote is stored with `[kind:Name]` tags (see
 * `direction/blocks.ts`); Production turns them into `<<<image_N>>>` tokens for the assets that
 * are ready as references, numbered by first appearance, and lists those assets in token order.
 * The same pass serves blocks cut before the Director existed (their tags came from the old
 * sectioning). Pure: no database, no Claude.
 */
import { ASSET_TAG_PATTERN, imageToken, isVoiceRef } from "@/server/damis";
import { promptForChosenAssets } from "./jobs";
import { MAX_BLOCK_ASSETS } from "./inputs";

export type PreparedPrompt = { prompt: string; assetRefs: string[]; notes: string[] };

/** `[kind:Name]`, with the space before it (so removing a tag leaves no double space). */
const TAG_WITH_SPACE = new RegExp(`( ?)${ASSET_TAG_PATTERN.source}`, "g");

/**
 * @param block the block's tagged `prompt`, its Director-listed `assetRefs` and the user's choice
 *   of references (`productionAssetRefs`, null when they made none)
 * @param ready the project's assets that can be attached (`ref` → name), voices excluded
 */
export function prepareBlockPrompt(
  block: { prompt: string; productionAssetRefs: string[] | null },
  ready: ReadonlyMap<string, string>,
): PreparedPrompt {
  const notes: string[] = [];
  const chosen = block.productionAssetRefs?.filter((ref) => !isVoiceRef(ref)) ?? null;
  // The user's choice decides which tags stay (and adds the ones the prompt does not tag).
  const tagged = chosen ? promptForChosenAssets(block.prompt, chosen, ready) : block.prompt;
  const assetRefs: string[] = [];
  const dropped = new Set<string>();
  const prompt = tagged.replace(TAG_WITH_SPACE, (_all, space: string, ref: string) => {
    if (isVoiceRef(ref)) return "";
    let n = assetRefs.indexOf(ref) + 1;
    if (n === 0) {
      if (!ready.has(ref) || assetRefs.length >= MAX_BLOCK_ASSETS) {
        dropped.add(ref);
        return "";
      }
      assetRefs.push(ref);
      n = assetRefs.length;
    }
    return `${space}${imageToken(n)}`;
  });
  for (const ref of dropped) {
    const name = ref.slice(ref.indexOf(":") + 1);
    notes.push(
      ready.has(ref)
        ? `This shot names more assets than a clip can attach (${MAX_BLOCK_ASSETS}); "${name}" is named in words only.`
        : `"${name}" has no reference sheet yet; it is named in words only.`,
    );
  }
  return { prompt, assetRefs, notes };
}
