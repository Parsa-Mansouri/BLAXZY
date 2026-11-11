import { notFound, redirect } from "next/navigation";
import { currentStageHref, stageLabel } from "@/lib/stages";
import { requireUser } from "@/server/auth";
import { ensurePrepared, getProductionOverview } from "@/server/production";
import { canOpenStage } from "@/server/projects";
import { finishedHref, phaseHref } from "../_lib/production-routes";
import { loadProject } from "../_lib/load-project";
import { ProductionLocked } from "./_components/production-locked";
import { preProductionLine } from "./_lib/pre-production-line";

/**
 * Production opens at the screen that matches the shots: review, clips or the finished film.
 * Before Pre-production is done it shows why it is locked and the way back; its deeper pages
 * still send a locked project back to its current stage.
 */
export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  const user = await requireUser();

  if (!canOpenStage(project, "production")) {
    const line =
      project.stage === "pre_production" ? await preProductionLine(project.id, user.id) : null;
    return (
      <ProductionLocked
        currentHref={currentStageHref(project.id, project.stage)}
        currentLabel={stageLabel(project.stage)}
        line={line}
      />
    );
  }

  if (project.stage === "done") redirect(finishedHref(project.id));
  await ensurePrepared(project.id, user.id);
  const overview = await getProductionOverview(project.id, user.id);
  if (!overview) notFound();
  redirect(phaseHref(project.id, overview.phase));
}
