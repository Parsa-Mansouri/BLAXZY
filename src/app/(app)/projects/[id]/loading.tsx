import { PageSkeleton } from "@/app/_components/route-states";

/** Shown at once while a page inside a project loads; the toolbar and stage strip stay. */
export default function ProjectLoading() {
  return <PageSkeleton />;
}
