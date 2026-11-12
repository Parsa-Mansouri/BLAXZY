import Link from "next/link";
import { fileSrc } from "@/lib/file-src";
import { Button, StatusLine, cn, stagger } from "@/ui";
import { assetHref, categoryHref } from "../../_lib/asset-kinds";
import { ASSET_STATUS_LABELS } from "../../_lib/asset-status";
import type { OverviewAsset, OverviewCategory } from "../_lib/load-categories";
import { statusWords } from "../_lib/status-words";
import { isWorking } from "./asset-stage";
import { KIND_ASPECTS } from "./gallery-item";

/** How many small pictures the leading block shows. */
const FEATURE_PICTURES = 5;
/** How many thumbnails a quiet tile shows. */
const TILE_THUMBS = 6;

/** A stored image filling its box; the box decides the shape. */
function Thumb({ fileId }: { fileId: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- user media from object storage, sized by the frame
    <img
      src={fileSrc(fileId)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="absolute inset-0 size-full object-cover object-top"
    />
  );
}

/** No picture or recording yet: the user still has to add one. */
const needsUser = (asset: OverviewAsset) =>
  !asset.thumbnailFileId && (asset.stage === "needs_image" || asset.stage === "needs_recording");

/** The one thing to do next in a category, as the leading block's white button. */
function nextStep(
  projectId: string,
  assets: OverviewAsset[],
): { label: string; href: string } | null {
  const find = (stage: OverviewAsset["stage"]) => assets.find((a) => a.stage === stage);
  const pick = (asset: OverviewAsset | undefined, label: (name: string) => string) =>
    asset ? { label: label(asset.name), href: assetHref(projectId, asset.id) } : null;
  return (
    pick(find("sheet_review"), (name) => `Review ${name}’s Sheet`) ??
    pick(find("look_review"), (name) => `Review ${name}’s Image`) ??
    pick(find("failed"), (name) => `Open ${name}`) ??
    pick(find("needs_image"), (name) => `Add an Image for ${name}`) ??
    pick(find("needs_recording"), (name) => `Add a Recording for ${name}`)
  );
}

/**
 * The leading category: a large block with what it needs, the one next step in white, and its
 * first pictures beside it.
 */
export function CategoryFeature({
  projectId,
  category,
  primary = true,
  className,
}: {
  projectId: string;
  category: OverviewCategory;
  /** False when the page header already carries the screen's one white button. */
  primary?: boolean;
  className?: string;
}) {
  const words = statusWords(category.counts);
  const step = nextStep(projectId, category.assets);
  const shown = category.assets.slice(0, FEATURE_PICTURES);
  const titleId = `category-${category.kind}`;
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex min-h-100 flex-wrap gap-x-12 gap-y-10 rounded-block bg-elevated p-6 sm:p-10",
        className,
      )}
    >
      <div className="flex min-w-0 flex-[1_1_320px] flex-col justify-between gap-10">
        <div className="flex flex-col gap-3">
          <h2 id={titleId} className="text-heading text-balance break-words uppercase">
            {category.plural}
          </h2>
          <StatusLine tone={words.tone} className="tabular-nums">
            {words.text}
          </StatusLine>
        </div>
        <div className="flex flex-wrap gap-3">
          {step ? (
            <Button
              variant={primary ? "primary" : "outlined"}
              size="large"
              render={<Link href={step.href} />}
              className="max-w-full"
            >
              <span className="truncate">{step.label}</span>
            </Button>
          ) : null}
          <Button
            variant={step ? "outlined" : "plain"}
            size="large"
            render={<Link href={categoryHref(projectId, category.kind)} />}
          >
            Open {category.plural}
          </Button>
        </div>
      </div>
      <ul className="flex min-w-0 flex-[1.6_1_420px] flex-wrap items-end justify-end gap-x-4 gap-y-4 self-end">
        {shown.map((asset, i) => (
          <li
            key={asset.id}
            className="flex max-w-56 min-w-0 flex-[1_1_96px] enter flex-col gap-2"
            style={stagger(i)}
          >
            <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-tile bg-selected p-2 text-center text-meta text-label-2">
              {asset.thumbnailFileId ? (
                <Thumb fileId={asset.thumbnailFileId} />
              ) : needsUser(asset) ? (
                <span>
                  {asset.stage === "needs_recording" ? "No recording yet" : "No image yet"}
                </span>
              ) : isWorking(asset.stage) ? (
                <span>{ASSET_STATUS_LABELS[asset.stage]}</span>
              ) : null}
            </div>
            <p className="line-clamp-2 min-w-0 text-meta break-words text-label-2">
              {asset.name}
              <span className="sr-only">, {ASSET_STATUS_LABELS[asset.stage]}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A quieter category: its name, what it needs, and a row of small thumbnails. */
export function CategoryTile({
  projectId,
  category,
  index,
}: {
  projectId: string;
  category: OverviewCategory;
  index: number;
}) {
  const words = statusWords(category.counts);
  const aspect = KIND_ASPECTS[category.kind];
  const voice = category.kind === "voice";
  return (
    <Link
      href={categoryHref(projectId, category.kind)}
      className="flex min-h-50 press enter flex-col justify-between gap-8 rounded-card bg-elevated p-6 focus-ring hover:bg-elevated-2"
      style={stagger(index, 500)}
    >
      <span className="flex flex-col gap-2">
        <span className="text-heading-sm break-words text-label uppercase">{category.plural}</span>
        <StatusLine as="span" tone={words.tone} className="tabular-nums">
          {words.text}
        </StatusLine>
      </span>
      <span aria-hidden="true" className="flex flex-wrap gap-2">
        {category.assets.slice(0, TILE_THUMBS).map((asset) => (
          <span
            key={asset.id}
            className={cn(
              "relative h-11 overflow-hidden bg-selected",
              aspect === "video" ? "w-17" : "w-11",
              voice ? "rounded-full" : "rounded-row",
            )}
          >
            {asset.thumbnailFileId ? <Thumb fileId={asset.thumbnailFileId} /> : null}
          </span>
        ))}
      </span>
    </Link>
  );
}
