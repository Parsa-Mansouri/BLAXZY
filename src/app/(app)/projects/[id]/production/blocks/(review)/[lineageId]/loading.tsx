import { Skeleton } from "@/ui";
import { FocusHeaderSkeleton } from "../../../_components/skeletons";

/**
 * One shot loading inside the shot review (the title and the list of shots stay): its title,
 * status line and decision, then its script on paper beside the assets it shows.
 */
export default function BlockLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-12">
      <FocusHeaderSkeleton />
      <div className="flex flex-wrap items-start gap-x-10 gap-y-12">
        <div className="flex min-w-0 flex-[3_1_28rem] flex-col gap-4 sm:max-w-205">
          <Skeleton className="h-6 w-20 rounded-paper" />
          <Skeleton className="h-64 rounded-paper" />
        </div>
        <div className="flex min-w-0 flex-[2_1_20rem] flex-col gap-4">
          <Skeleton className="h-6 w-28 rounded-paper" />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-4 gap-y-6">
            <Skeleton className="aspect-video rounded-card" />
            <Skeleton className="aspect-video rounded-card" />
          </div>
        </div>
      </div>
    </div>
  );
}
