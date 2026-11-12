import { StageSkeleton } from "@/app/_components/route-states";

/**
 * Shown at once while a page inside a project loads; the toolbar and stage strip stay. Shaped
 * like a stage page: header, list on the left, focus area filling the height on the right.
 */
export default function ProjectLoading() {
  return <StageSkeleton />;
}
