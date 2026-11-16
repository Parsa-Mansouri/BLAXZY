import { Skeleton } from "@/ui";

/** Home while it loads: the hero block, the start field and a shelf of film tiles. */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col pt-(--toolbar-h)">
      <Skeleton className="mx-3 mb-3 min-h-[max(520px,56dvh)] rounded-block" />
      <div className="flex flex-col gap-16 px-(--content-x) pt-11 pb-18">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-48 rounded-row" />
          <Skeleton className="h-12 w-full rounded-row" />
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-6 w-32 rounded-row" />
          <div className="flex gap-6">
            <Skeleton className="h-6 w-12 rounded-row" />
            <Skeleton className="h-6 w-24 rounded-row" />
            <Skeleton className="h-6 w-20 rounded-row" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-x-6 gap-y-9">
            {[0, 1, 2].map((key) => (
              <div key={key} className="flex flex-col gap-3">
                <Skeleton className="aspect-video rounded-card" />
                <Skeleton className="h-5 w-2/3 rounded-row" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
