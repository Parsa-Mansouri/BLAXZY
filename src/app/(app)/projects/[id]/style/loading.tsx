import { Skeleton } from "@/ui";

/**
 * Shown at once while the Style screen loads, shaped like it: the title and its rule, the five
 * questions on the left, and the question with its picture options and Next on the right.
 */
export default function StyleLoading() {
  return (
    <div role="status" aria-label="Loading the style" className="flex flex-1 flex-col">
      <Skeleton className="h-12 w-56 max-w-full rounded-row" />
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 mb-8 h-5 w-96 max-w-full rounded-row" />

      <div className="flex flex-1 flex-wrap gap-x-20 gap-y-10">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5 self-start sm:max-w-80">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-15 rounded-row" />
          ))}
        </div>
        <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-12">
          <div className="flex flex-1 flex-col gap-6">
            <Skeleton className="h-9 w-[min(100%,28rem)] rounded-row" />
            <div className="grid min-h-0 flex-1 auto-rows-[minmax(180px,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} />
              ))}
            </div>
          </div>
          <Skeleton className="h-(--btn-lg) w-28 rounded-capsule" />
        </div>
      </div>
    </div>
  );
}
