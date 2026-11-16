/**
 * What the Video Review and the router compare: the references a block says to attach (expected)
 * and the files a take was actually generated with (actual), as `ReferenceBindingEntry` rows with
 * the tokens `image_1`, `image_2`, ... in attachment order. Asset ids are the Director's
 * (`char_1`) when the block's direction names the asset, else the asset's own id; a "sheet id" is
 * the id of the reference file (the accepted sheet, else the look, of the asset). Helpers are pure
 * apart from `loadBoundAssets`.
 */
import { describeAssetRefs, listReadyReferenceAssets, type ReferenceAsset } from "@/server/assets";
import type { PromptBlock } from "@/server/blocks";
import { nameKey, type ReferenceBindingEntry } from "@/server/damis";
import type { DbExecutor } from "@/server/db/client";
import type { AssetKind } from "@/server/db/schema";

const DIRECTOR_PREFIX: Partial<Record<AssetKind, string>> = {
  character: "char_",
  location: "loc_",
  prop: "prop_",
  voice: "voice_",
};

/** The Director's id of an asset (from the block's `asset_names`), else the asset's own id. */
export function reviewAssetId(
  asset: Pick<ReferenceAsset, "assetId" | "kind" | "name">,
  assetNames: Readonly<Record<string, string>>,
): string {
  for (const [id, name] of Object.entries(assetNames)) {
    const prefix = DIRECTOR_PREFIX[asset.kind];
    if (prefix !== undefined && id.startsWith(prefix) && nameKey(name) === nameKey(asset.name)) {
      return id;
    }
  }
  return asset.assetId;
}

/** The `asset_names` a block's direction carries (empty for old blocks). */
export function directionAssetNames(direction: unknown): Record<string, string> {
  if (!direction || typeof direction !== "object") return {};
  const names = (direction as { asset_names?: unknown }).asset_names;
  if (!names || typeof names !== "object") return {};
  return Object.fromEntries(
    Object.entries(names as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
}

export const tokenOf = (position: number) => `image_${position}`;

export type BoundAsset = {
  /** `image_N`, N being the 1-based attachment position. */
  token: string;
  ref: string;
  /** The id the review and the router use for the asset. */
  reviewId: string;
  name: string;
  kind: AssetKind;
  /** What generation attaches for the asset now (null when it is not ready). */
  fileId: string | null;
};

/** The block's prepared references in token order, with what each attaches now. */
export async function loadBoundAssets(
  block: Pick<PromptBlock, "projectId" | "productionAssetRefs" | "direction">,
  db?: DbExecutor,
): Promise<BoundAsset[]> {
  const refs = block.productionAssetRefs ?? [];
  const names = directionAssetNames(block.direction);
  const found = await describeAssetRefs(block.projectId, refs, db);
  const bound: BoundAsset[] = [];
  refs.forEach((ref, i) => {
    const asset = found.get(ref);
    if (!asset) return;
    bound.push({
      token: tokenOf(i + 1),
      ref,
      reviewId: reviewAssetId(asset, names),
      name: asset.name,
      kind: asset.kind,
      fileId: asset.ready ? asset.referenceFileId : null,
    });
  });
  return bound;
}

/** What the block says to attach. */
export function expectedBinding(bound: readonly BoundAsset[]): ReferenceBindingEntry[] {
  return bound.map((b) => ({ token: b.token, asset_id: b.reviewId, sheet_id: b.fileId ?? "" }));
}

/**
 * What the take was attached with: the file at each position, read as the asset it belongs to
 * (`fileOwners`: reference file id to review asset id, from the project's ready assets). A file
 * that belongs to no ready asset is read as an old sheet of the asset expected at that position.
 * Positions past the end of `referenceFileIds` have no entry (a missing token).
 */
export function actualBinding(
  bound: readonly BoundAsset[],
  referenceFileIds: readonly string[],
  fileOwners: ReadonlyMap<string, string>,
): ReferenceBindingEntry[] {
  const out: ReferenceBindingEntry[] = [];
  bound.forEach((want, i) => {
    const fileId = referenceFileIds[i];
    if (fileId === undefined) return;
    out.push({
      token: want.token,
      asset_id: fileOwners.get(fileId) ?? want.reviewId,
      sheet_id: fileId,
    });
  });
  return out;
}

/** Reference file id to review asset id for every ready asset of the project. */
export async function readyFileOwners(
  block: Pick<PromptBlock, "projectId" | "direction">,
  db?: DbExecutor,
): Promise<{ owners: Map<string, string>; assets: (ReferenceAsset & { reviewId: string })[] }> {
  const names = directionAssetNames(block.direction);
  const ready = await listReadyReferenceAssets(block.projectId, db);
  const assets = ready.map((a) => ({ ...a, reviewId: reviewAssetId(a, names) }));
  const owners = new Map<string, string>();
  for (const a of assets) if (a.referenceFileId) owners.set(a.referenceFileId, a.reviewId);
  return { owners, assets };
}

/**
 * The reference files with the fixes applied: positions named by `fixedTokens` take the file the
 * block expects, other positions keep what was attached (or the expected file when none was).
 * Throws a message-safe Error when an expected asset has no file.
 */
export function correctedReferences(
  bound: readonly BoundAsset[],
  referenceFileIds: readonly string[],
  fixedTokens: ReadonlySet<string>,
  missing: (asset: BoundAsset) => Error,
): string[] {
  return bound.map((want, i) => {
    const keep = referenceFileIds[i];
    if (!fixedTokens.has(want.token) && keep !== undefined) return keep;
    if (!want.fileId) throw missing(want);
    return want.fileId;
  });
}
