"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ProductionBlockAsset } from "@/server/production";
import { fileSrc } from "@/lib/file-src";
import { PaperSheet, cn } from "@/ui";
import { ASSET_KIND_LABELS, assetHref } from "../../../../../_lib/asset-kinds";
import { promptParts } from "../../../_lib/clip-view";

const kindName = (kind: ProductionBlockAsset["kind"]) => {
  const one = ASSET_KIND_LABELS.find((k) => k.kind === kind)?.one ?? "asset";
  return one.charAt(0).toUpperCase() + one.slice(1);
};

/** The shot's script on paper, the assets it shows and, folded away, the prompt it was made from. */
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
    <div className="flex flex-col gap-12">
      {assets.length > 0 ? (
        <section aria-labelledby={`${id}-assets`} className="flex flex-col gap-4">
          <h3 id={`${id}-assets`} className="text-section">
            In This Shot
          </h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-1">
            {assets.map((asset) => (
              <li key={asset.ref}>
                <Link
                  href={assetHref(projectId, asset.assetId)}
                  className="flex press items-center gap-3 rounded-tile p-1.5 pr-3 focus-ring hover:bg-fill-4"
                >
                  <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-paper bg-elevated">
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
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium text-label">{asset.name}</span>
                    <span className="text-secondary text-label-2">{kindName(asset.kind)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {scriptExcerpt.trim() ? (
        <section aria-labelledby={`${id}-script`} className="flex flex-col gap-4">
          <h3 id={`${id}-script`} className="text-section">
            Script
          </h3>
          <PaperSheet as="div" className="max-w-205">
            <p className="break-words whitespace-pre-wrap">{scriptExcerpt.trim()}</p>
          </PaperSheet>
        </section>
      ) : null}

      {prompt ? (
        <section className="flex flex-col gap-3">
          <h3>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`${id}-prompt`}
              onClick={() => setOpen((v) => !v)}
              className="-ml-1 inline-flex press items-center gap-1 rounded-row py-0.5 pr-1.5 text-section text-label-2 focus-ring hover:text-label"
            >
              <ChevronRight
                aria-hidden
                strokeWidth={1.5}
                className={cn(
                  "size-(--icon) transition-transform duration-(--dur-press) ease-out",
                  open && "rotate-90",
                )}
              />
              Prompt
            </button>
          </h3>
          <div id={`${id}-prompt`} hidden={!open} className={open ? "swap-in" : undefined}>
            <p className="max-w-(--measure) text-body break-words whitespace-pre-wrap text-label-2">
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
