import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import {
  DEFAULT_BLOCK_PAGE_SIZE,
  getProductionOverview,
  listProductionBlocks,
} from "@/server/production";
import { loadProjectForStage } from "../../../_lib/load-stage";
import { BlockReviewFrame } from "../_components/block-review-frame";

/**
 * The shot review: the header and the list of shots stay while the user moves from shot to
 * shot; only the shot in the focus area changes.
 */
export default async function BlockReviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "production");
  const user = await requireUser();
  const [overview, page] = await Promise.all([
    getProductionOverview(project.id, user.id),
    listProductionBlocks(project.id, user.id, { limit: DEFAULT_BLOCK_PAGE_SIZE }),
  ]);
  if (!overview || !page) notFound();

  return (
    <BlockReviewFrame
      projectId={project.id}
      initial={{
        items: page.items,
        nextCursor: page.nextCursor,
        counts: overview.counts,
        phase: overview.phase,
        projectStage: overview.projectStage,
        canStartDrafts: overview.canStartDrafts,
      }}
    >
      {children}
    </BlockReviewFrame>
  );
}
