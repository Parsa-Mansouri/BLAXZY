import { StagePlaceholder } from "../_components/stage-placeholder";
import { loadProjectForStage } from "../_lib/load-stage";

export default async function PreProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadProjectForStage(id, "pre_production");
  return <StagePlaceholder stage="pre_production" />;
}
