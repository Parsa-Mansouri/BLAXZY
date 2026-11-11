/**
 * Assets (Output_021): what the story needs to keep consistent. `applyDetection`,
 * `hasDetectionFor`, `getKnownAssets` and `getSectionerAssets` are for job handlers; the rest take
 * the acting user and check ownership.
 */
export {
  applyDetection,
  AssetInputError,
  countAssetsByKind,
  DEFAULT_ASSET_PAGE_SIZE,
  getKnownAssets,
  getSectionerAssets,
  hasDetectionFor,
  listAssets,
  MAX_ASSET_PAGE_SIZE,
  type Asset,
} from "./service";
