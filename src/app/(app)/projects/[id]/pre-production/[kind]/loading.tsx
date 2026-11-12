import { Skeleton } from "@/ui";
import { FILL_PAGE } from "../_lib/fill";

/** A category while it loads: title, then a grid of picture cards with their names. */
export default function CategoryLoading() {
  return (
    <div role="status" aria-label="Loading" className={FILL_PAGE}>
      <Skeleton className="h-12 w-72 max-w-full rounded-row" />
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 mb-8 h-5 w-64 max-w-full rounded-row" />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-7 gap-y-10">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <li key={n} className="flex min-w-0 flex-col gap-3">
            <Skeleton className="aspect-[4/5] rounded-card" />
            <Skeleton className="h-5 w-2/3" />
          </li>
        ))}
      </ul>
    </div>
  );
}
