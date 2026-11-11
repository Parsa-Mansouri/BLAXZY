import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { ensurePrepared, getProductionOverview } from "@/server/production";
import { finishedHref, phaseHref } from "../_lib/production-routes";
import { loadProjectForStage } from "../_lib/load-stage";

/** Production opens at the screen that matches the shots: review, clips or the finished film. */
export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "production");
  if (project.stage === "done") redirect(finishedHref(project.id));
  const user = await requireUser();
  await ensurePrepared(project.id, user.id);
  const overview = await getProductionOverview(project.id, user.id);
  if (!overview) notFound();
  redirect(phaseHref(project.id, overview.phase));
}
