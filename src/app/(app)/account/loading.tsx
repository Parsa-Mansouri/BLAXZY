import { Skeleton } from "@/ui";

/** A label and value row, like the profile rows. */
function RowSkeleton() {
  return (
    <div className="flex items-center gap-x-6 py-3">
      <Skeleton className="h-5 w-24 rounded-row" />
      <Skeleton className="h-6 w-56 max-w-full rounded-row" />
    </div>
  );
}

/** Account while it loads: the title, the profile and password column, the credits column. */
export default function AccountLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col px-(--content-x) pt-(--toolbar-h) pb-18"
    >
      <div className="mt-8 mb-8">
        <Skeleton className="h-12 w-60 max-w-full rounded-row" />
        <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      </div>
      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-2">
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-24 rounded-row" />
            <RowSkeleton />
            <RowSkeleton />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-6 w-28 rounded-row" />
            <Skeleton className="h-(--btn) w-44 rounded-capsule" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-32 rounded-row" />
          <Skeleton className="h-10 w-40 rounded-row" />
        </div>
      </div>
    </div>
  );
}
