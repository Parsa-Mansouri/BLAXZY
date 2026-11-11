import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { ProgressBar, cn } from "@/ui";
import { categoryHref, readyWords } from "../../_lib/asset-kinds";
import type { CategorySummary } from "../../_lib/load-overview";
import { KIND_FRAMES, KIND_ICONS } from "./asset-gallery";

/** Grid of the collage by number of frames; class names are literal for Tailwind. */
const COLLAGE_GRID: Record<number, string> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-2 grid-rows-1",
  3: "grid-cols-2 grid-rows-2",
  4: "grid-cols-2 grid-rows-2",
};

function Collage({ category }: { category: CategorySummary }) {
  const Icon = KIND_ICONS[category.kind];
  const portrait = KIND_FRAMES[category.kind] === "portrait";
  const count = category.slots.length;
  return (
    <div
      className={cn(
        "grid aspect-[4/3] w-full gap-1 overflow-hidden rounded-artwork bg-ground",
        COLLAGE_GRID[count],
      )}
    >
      {category.slots.map((fileId, i) => (
        <div
          key={i}
          className={cn(
            "relative min-h-0 min-w-0 overflow-hidden bg-elevated",
            count === 3 && i === 0 && "row-span-2",
          )}
        >
          {fileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- user media from object storage, sized by the frame
            <img
              src={fileSrc(fileId)}
              alt=""
              loading="lazy"
              decoding="async"
              className={cn(
                "absolute inset-0 size-full object-cover transition-transform duration-(--dur-slide-motion) ease-out group-hover/tile:scale-[1.03] motion-reduce:transition-none",
                portrait && "object-top",
              )}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-label-3">
              <Icon
                aria-hidden
                strokeWidth={1.25}
                className={count === 1 ? "size-16" : "size-10"}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** One large tile for a kind of asset: a collage of its images, its name and its progress. */
export function CategoryTile({
  projectId,
  category,
}: {
  projectId: string;
  category: CategorySummary;
}) {
  const percent = category.total === 0 ? 0 : (category.ready / category.total) * 100;
  const words = readyWords(category.ready, category.total);
  return (
    <Link
      href={categoryHref(projectId, category.kind)}
      className="group/tile flex min-w-0 flex-col gap-4 rounded-artwork focus-ring outline-offset-4"
    >
      <Collage category={category} />
      <div className="flex flex-col gap-2.5 px-0.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-title-1">{category.plural}</h3>
          <ChevronRight
            aria-hidden
            className="size-(--icon) text-label-3 transition-transform duration-(--dur-fast) group-hover/tile:translate-x-0.5 motion-reduce:transition-none"
          />
        </div>
        <p className="text-body text-label-2 tabular-nums">{words}</p>
        <ProgressBar
          value={percent}
          tone={category.ready === category.total ? "success" : "default"}
          aria-label={`${category.plural}: ${words}`}
        />
      </div>
    </Link>
  );
}
