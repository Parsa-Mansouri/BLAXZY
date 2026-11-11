"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronRight, ImageOff } from "lucide-react";
import type { ProductionBlockAsset } from "@/server/production";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";
import { ASSET_KIND_LABELS, assetHref } from "../../../../_lib/asset-kinds";
import { promptParts } from "../../_lib/clip-view";

const kindName = (kind: ProductionBlockAsset["kind"]) => {
  const one = ASSET_KIND_LABELS.find((k) => k.kind === kind)?.one ?? "asset";
  return one.charAt(0).toUpperCase() + one.slice(1);
};

/** The shot's script, the assets it shows and, folded away, the prompt the clip was made from. */
export function ShotDetails({
  projectId,
  scriptExcerpt,
  assets,
  prompt,
}: {
  projectId: string;
  scriptExcerpt: string;
  assets: ProductionBlockAsset[];
  prompt: string | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const parts = prompt ? promptParts(prompt, assets) : [];

  return (
    <div className="flex flex-col gap-7">
      {scriptExcerpt.trim() ? (
        <section aria-labelledby={`${id}-script`} className="flex flex-col gap-2">
          <h3 id={`${id}-script`} className="text-headline text-label-2">
            Script
          </h3>
          <p className="max-w-(--measure) text-script break-words whitespace-pre-wrap text-label">
            {scriptExcerpt.trim()}
          </p>
        </section>
      ) : null}

      {assets.length > 0 ? (
        <section aria-labelledby={`${id}-assets`} className="flex flex-col gap-2.5">
          <h3 id={`${id}-assets`} className="text-headline text-label-2">
            In This Shot
          </h3>
          <ul className="flex flex-col gap-1">
            {assets.map((asset) => (
              <li key={asset.ref}>
                <Link
                  href={assetHref(projectId, asset.assetId)}
                  className="-mx-1.5 flex items-center gap-3 rounded-field p-1.5 focus-ring transition-colors duration-(--dur-fast) hover:bg-fill-4"
                >
                  <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-field bg-elevated">
                    {asset.thumbnailFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a redirect to a presigned URL
                      <img
                        src={fileSrc(asset.thumbnailFileId)}
                        alt=""
                        width={44}
                        height={44}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <ImageOff aria-hidden className="size-4 text-label-3" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-label">{asset.name}</span>
                    <span className="text-callout text-label-2">{kindName(asset.kind)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prompt ? (
        <section className="flex flex-col gap-2">
          <h3>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`${id}-prompt`}
              onClick={() => setOpen((v) => !v)}
              className="-ml-1 inline-flex items-center gap-1 rounded-control py-0.5 pr-1.5 text-headline text-label-2 focus-ring transition-colors duration-(--dur-fast) hover:text-label"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "size-(--icon) transition-transform duration-(--dur-fast) motion-reduce:transition-none",
                  open && "rotate-90",
                )}
              />
              Prompt
            </button>
          </h3>
          <div id={`${id}-prompt`} hidden={!open}>
            <p className="max-w-(--measure) text-reading break-words whitespace-pre-wrap text-label-2">
              {parts.map((part, i) =>
                part.kind === "text" ? (
                  <span key={i}>{part.text}</span>
                ) : (
                  <span key={i} className="font-medium text-label">
                    {part.name}
                  </span>
                ),
              )}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
