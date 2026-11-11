import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import {
  ensurePrepared,
  getProductionOverview,
  listProductionBlocks,
  DEFAULT_BLOCK_PAGE_SIZE,
} from "@/server/production";
import { loadProjectForStage } from "../../_lib/load-stage";
import { finishedHref, phaseHref } from "../../_lib/production-routes";
import { BlocksScreen } from "./_components/blocks-screen";

export default async function BlocksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "production");
  if (project.stage === "done") redirect(finishedHref(project.id));
  const user = await requireUser();
  await ensurePrepared(project.id, user.id);
  const overview = await getProductionOverview(project.id, user.id);
  if (!overview) notFound();
  if (overview.phase === "generating" || overview.phase === "finished") {
    redirect(phaseHref(project.id, overview.phase));
  }
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
        canStartDrafts: overview.canStartDrafts,
      }}
    />
  );
}
