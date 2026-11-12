import { Skeleton } from "@/ui";

/**
 * Shown at once while the Script screen loads, shaped like the script under review: the title,
 * its rule and the two actions, the scene list on the left and the page (up to 820px) beside it.
 * Neutral blocks only: no sample screenplay text.
 */
export default function ScriptLoading() {
  return (
    <div role="status" aria-label="Loading the script" className="flex flex-1 flex-col">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <Skeleton className="h-12 w-56 max-w-full rounded-row" />
          <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
          <Skeleton className="mt-3 h-5 w-96 max-w-full rounded-row" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-(--btn-lg) w-44 rounded-capsule" />
          <Skeleton className="h-(--btn-lg) w-40 rounded-capsule" />
        </div>
      </div>

      <div className="flex flex-1 flex-wrap gap-x-12 gap-y-10">
        <div className="flex min-w-0 flex-[1_1_176px] flex-col gap-0.5 self-start sm:max-w-44 2xl:max-w-60">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-row" />
          ))}
        </div>
        <div className="flex min-w-0 flex-[4_1_560px] flex-col">
          <Skeleton className="min-h-[60dvh] w-full max-w-205 flex-1 rounded-paper" />
        </div>
      </div>
    </div>
  );
}
