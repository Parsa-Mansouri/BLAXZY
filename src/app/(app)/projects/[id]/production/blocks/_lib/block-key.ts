/** What a shot's screen shows, as one string: when it changes, the page is out of date. */
export function blockKey(block: {
  id: string;
  stage: string;
  busy: boolean;
  assets: { assetId: string }[];
  failure: string | null;
}): string {
  return [
    block.id,
    block.stage,
    block.busy ? "busy" : "idle",
    block.assets.map((a) => a.assetId).join(","),
    block.failure ?? "",
  ].join("|");
}
