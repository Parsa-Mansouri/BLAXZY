import { PageSkeleton } from "../_components/route-states";

/** Shown at once while a signed-in page loads; the sidebar stays in place. */
export default function AppLoading() {
  return (
    <div className="px-(--content-x) pt-(--toolbar-h) pb-18">
      <PageSkeleton />
    </div>
  );
}
