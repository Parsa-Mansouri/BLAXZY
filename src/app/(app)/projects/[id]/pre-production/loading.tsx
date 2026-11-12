import { Skeleton } from "@/ui";
import { FILL_PAGE } from "./_lib/fill";

/** The overview while it loads: title, the leading block, the quieter tiles, the shots. */
export default function PreProductionLoading() {
  return (
    <div role="status" aria-label="Loading" className={FILL_PAGE}>
      <Skeleton className="h-12 w-72 max-w-full rounded-row" />
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 mb-8 h-5 w-64 max-w-full rounded-row" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="min-h-100 flex-1 rounded-block" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
          <Skeleton className="h-50 rounded-card" />
          <Skeleton className="h-50 rounded-card" />
          <Skeleton className="h-50 rounded-card" />
        </div>
      </div>
      <Skeleton className="mt-16 h-6 w-24 rounded-row" />
      <Skeleton className="mt-4 h-5 w-96 max-w-full rounded-row" />
    </div>
  );
}
