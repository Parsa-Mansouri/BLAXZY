import { notFound } from "next/navigation";
import { listProductionBlocks, DEFAULT_BLOCK_PAGE_SIZE } from "@/server/production";
import { loadProduction } from "../../_lib/load-production";
import { blocksHref } from "../../_lib/production-routes";
import { BlocksScreen } from "./_components/blocks-screen";

export default async function BlocksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, user, overview } = await loadProduction(id, {
    screen: "blocks",
    href: blocksHref,
  });
  const page = await listProductionBlocks(project.id, user.id, {
    limit: DEFAULT_BLOCK_PAGE_SIZE,
  });
  if (!page) notFound();

  return (
    <BlocksScreen
      projectId={project.id}
      initial={{
        items: page.items,
        nextCursor: page.nextCursor,
        counts: overview.counts,
        phase: overview.phase,
        projectStage: overview.projectStage,
        canStartDrafts: overview.canStartDrafts,
      }}
    />
  );
}
