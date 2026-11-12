import { Skeleton } from "@/ui";

/** Projects while it loads: the title row with its action, the filter tabs and the tiles. */
export default function ProjectsLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col px-(--content-x) pt-(--toolbar-h) pb-18"
    >
      <div className="mt-8 mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <Skeleton className="h-12 w-72 max-w-full rounded-row" />
          <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
          <Skeleton className="mt-3 h-5 w-64 max-w-full rounded-row" />
        </div>
        <Skeleton className="h-(--btn-lg) w-40 rounded-capsule" />
      </div>
      <div className="mb-8 flex gap-6">
        <Skeleton className="h-6 w-12 rounded-row" />
        <Skeleton className="h-6 w-24 rounded-row" />
        <Skeleton className="h-6 w-20 rounded-row" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-x-6 gap-y-9">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <div key={key} className="flex flex-col gap-3">
            <Skeleton className="aspect-video rounded-card" />
            <Skeleton className="h-5 w-2/3 rounded-row" />
          </div>
        ))}
      </div>
    </div>
  );
}
