import { Skeleton } from "@/ui";
import { FocusHeaderSkeleton, PlayerSkeleton } from "../../../_components/skeletons";

/**
 * One clip loading inside the clip review (the title and the list of shots stay): its title,
 * the player at full size and the decision beside it.
 */
export default function ClipLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <FocusHeaderSkeleton buttons={0} />
      <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
        <div className="min-w-0 flex-[999_1_560px]">
          <PlayerSkeleton />
        </div>
        <div className="flex max-w-160 min-w-0 flex-[1_1_20rem] flex-col gap-5">
          <Skeleton className="h-6 w-44 rounded-paper" />
          <Skeleton className="h-4 w-full rounded-paper" />
          <Skeleton className="h-4 w-2/3 rounded-paper" />
          <div className="flex gap-3">
            <Skeleton className="h-(--btn-lg) w-28 rounded-capsule" />
            <Skeleton className="h-(--btn-lg) w-44 rounded-capsule" />
          </div>
        </div>
      </div>
    </div>
  );
}
