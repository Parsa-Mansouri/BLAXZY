import { HeaderSkeleton, LoadingPage, PosterGridSkeleton } from "../_components/skeletons";

/** The clips board while it loads: the title, the status line, then the poster cards. */
export default function ClipsLoading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <PosterGridSkeleton />
    </LoadingPage>
  );
}
