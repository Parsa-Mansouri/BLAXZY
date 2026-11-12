import { Skeleton } from "@/ui";
import { FILL_PAGE } from "../_lib/fill";

/** Review Sheets while it loads: the list of sheets and the large sheet beside it. */
export default function ReviewLoading() {
  return (
    <div role="status" aria-label="Loading" className={FILL_PAGE}>
      <Skeleton className="h-12 w-72 max-w-full rounded-row" />
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 mb-8 h-5 w-64 max-w-full rounded-row" />
      <div className="flex flex-1 flex-wrap items-stretch gap-x-20 gap-y-10">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2 sm:max-w-80">
          {[0, 1, 2, 3, 4].map((n) => (
            <Skeleton key={n} className="h-14 rounded-row" />
          ))}
        </div>
        <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-card" />
          <Skeleton className="h-9 w-1/2 rounded-row" />
        </div>
      </div>
    </div>
  );
}
