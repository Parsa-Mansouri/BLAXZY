import { Skeleton } from "@/ui";

/** New Project while it loads: the title, the big working-title field and the two buttons. */
export default function NewProjectLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-dvh flex-col px-(--content-x) pt-(--toolbar-h) pb-18"
    >
      <div className="mt-8 mb-8">
        <Skeleton className="h-12 w-96 max-w-full rounded-row" />
        <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      </div>
      <div className="my-auto flex flex-col gap-4 py-10">
        <Skeleton className="h-24 w-full rounded-row" />
        <Skeleton className="h-5 w-56 rounded-row" />
      </div>
      <div className="flex items-center gap-5">
        <Skeleton className="h-(--btn-lg) w-44 rounded-capsule" />
        <Skeleton className="h-(--btn-lg) w-24 rounded-capsule" />
      </div>
    </div>
  );
}
