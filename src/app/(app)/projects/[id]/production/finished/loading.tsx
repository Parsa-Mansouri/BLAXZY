import { Skeleton } from "@/ui";
import { HeaderSkeleton, LoadingPage, PosterGridSkeleton } from "../_components/skeletons";

/** The finished shelf while it loads: the title with Download All, then the poster cards. */
export default function FinishedLoading() {
  return (
    <LoadingPage>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <HeaderSkeleton wide />
        <Skeleton className="mb-8 h-(--btn-lg) w-44 rounded-capsule" />
      </div>
      <PosterGridSkeleton />
    </LoadingPage>
  );
}
