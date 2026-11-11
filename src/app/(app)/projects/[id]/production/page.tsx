import { StagePlaceholder } from "../_components/stage-placeholder";
import { loadProjectForStage } from "../_lib/load-stage";

export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadProjectForStage(id, "production");
  return <StagePlaceholder stage="production" />;
}
