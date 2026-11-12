import { Skeleton } from "@/ui";
import { FILL_PAGE } from "../../_lib/fill";

/** An asset while it loads: its name, the picture frame, and the panel beside it. */
export default function AssetLoading() {
  return (
    <div role="status" aria-label="Loading" className={FILL_PAGE}>
      <Skeleton className="h-12 w-72 max-w-full rounded-row" />
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 mb-8 h-5 w-64 max-w-full rounded-row" />
      <div className="flex flex-1 flex-wrap items-start gap-x-16 gap-y-10">
        <Skeleton className="aspect-video min-w-0 flex-[3_1_480px] rounded-card" />
        <div className="flex max-w-105 min-w-0 flex-[1_1_340px] flex-col gap-4">
          <Skeleton className="h-9 w-3/4 rounded-row" />
          <Skeleton className="h-5 w-full rounded-row" />
          <Skeleton className="mt-4 h-12 w-full rounded-capsule" />
          <Skeleton className="h-12 w-full rounded-capsule" />
        </div>
      </div>
    </div>
  );
}
