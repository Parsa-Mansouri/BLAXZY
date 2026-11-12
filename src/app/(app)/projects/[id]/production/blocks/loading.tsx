import { Skeleton } from "@/ui";
import { HeaderSkeleton, LoadingPage, ShotRowsSkeleton } from "../_components/skeletons";

/** The Shots screen while it loads: the title, the next step as a large block, then the shots. */
export default function BlocksLoading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <div className="flex flex-1 flex-wrap gap-3">
        <Skeleton className="min-h-75 flex-[2_1_320px] rounded-block" />
        <Skeleton className="min-h-30 flex-[1_1_220px] rounded-block" />
      </div>
      <div className="mt-12">
        <ShotRowsSkeleton />
      </div>
    </LoadingPage>
  );
}
