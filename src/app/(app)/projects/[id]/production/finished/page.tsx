import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { getProductionOverview, listFinishedClips } from "@/server/production";
import { loadProjectForStage } from "../../_lib/load-stage";
import { phaseHref } from "../../_lib/production-routes";
import { FinishedScreen } from "./_components/finished-screen";

const PAGE_SIZE = 24;

export default async function FinishedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "production");
  const user = await requireUser();
  const overview = await getProductionOverview(project.id, user.id);
  if (!overview) notFound();
  // Until every shot has its final clip, the film is not finished: go where the work is.
  if (overview.phase !== "finished") redirect(phaseHref(project.id, overview.phase));
  const page = await listFinishedClips(project.id, user.id, { limit: PAGE_SIZE });
  if (!page) notFound();

  return (
    <FinishedScreen
      projectId={project.id}
      initial={page.items}
      initialCursor={page.nextCursor}
      portrait={project.style?.orientation === "portrait"}
    />
  );
}
