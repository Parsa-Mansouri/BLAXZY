import { assetHref } from "../../../../_lib/asset-kinds";

/**
 * Where an asset page opens when a card's action leads there: a way of adding the image, the
 * request-changes panel, or the confirmation to change the image.
 */
export const ASSET_INTENTS = ["questions", "prompt", "upload", "changes", "change"] as const;

export type AssetIntent = (typeof ASSET_INTENTS)[number];

export function parseIntent(value: string | string[] | undefined): AssetIntent | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return ASSET_INTENTS.find((intent) => intent === raw) ?? null;
}

/** The asset page, opened at `intent` (`?open=questions`). */
export function assetIntentHref(projectId: string, assetId: string, intent?: AssetIntent): string {
  const href = assetHref(projectId, assetId);
  return intent ? `${href}?open=${intent}` : href;
}
