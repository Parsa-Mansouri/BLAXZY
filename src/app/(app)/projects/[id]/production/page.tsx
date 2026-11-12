import { currentStageHref, stageLabel } from "@/lib/stages";
import { requireUser } from "@/server/auth";
import { canOpenStage } from "@/server/projects";
import { loadProduction } from "../_lib/load-production";
import { loadProject } from "../_lib/load-project";
import { ProductionLocked } from "./_components/production-locked";
import { preProductionLine } from "./_lib/pre-production-line";

/**
 * Production opens at the screen that matches the shots: review, clips or the finished film
 * (`productionDestination`). Entering prepares the shots that need it, whatever the stage.
 * Before Pre-production is done it shows why it is locked and the way back; its deeper pages
 * still send a locked project back to its current stage.
 */
export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);

  if (!canOpenStage(project, "production")) {
    const user = await requireUser();
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

  await loadProduction(id, "entry");
  return null;
}
