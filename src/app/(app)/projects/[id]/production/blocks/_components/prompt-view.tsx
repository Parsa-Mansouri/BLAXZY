import { fileSrc } from "@/lib/file-src";
import type { ProductionBlockAsset } from "@/server/production";
import { splitPrompt } from "../_lib/prompt-tokens";
import { StoredImage } from "@/ui";

/** An asset named inside the prompt: its sheet as a small round image and its name. */
function AssetChip({ asset, index }: { asset: ProductionBlockAsset | undefined; index: number }) {
  return (
    <span className="mx-0.5 inline-flex translate-y-[0.2em] items-center gap-1.5 rounded-capsule bg-fill py-0.5 pr-2.5 pl-0.5 align-baseline text-secondary text-label">
      {asset?.thumbnailFileId ? (
        <StoredImage
          src={fileSrc(asset.thumbnailFileId)}
          alt=""
          width={20}
          height={20}
          className="size-5 rounded-full object-cover"
        />
      ) : (
        <span aria-hidden className="size-5 rounded-full bg-fill-2" />
      )}
      {asset?.name ?? `Asset ${index}`}
    </span>
  );
}

/** The prepared prompt as readable text, with each reference token shown as the asset it stands for. */
export function PromptView({ prompt, assets }: { prompt: string; assets: ProductionBlockAsset[] }) {
  return (
    <p className="max-w-(--measure) text-body whitespace-pre-wrap text-label">
      {splitPrompt(prompt).map((segment, i) =>
        segment.type === "text" ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <AssetChip key={i} asset={assets[segment.index - 1]} index={segment.index} />
        ),
      )}
    </p>
  );
}
