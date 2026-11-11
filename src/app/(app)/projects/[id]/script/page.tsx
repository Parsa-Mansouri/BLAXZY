import { StagePlaceholder } from "../_components/stage-placeholder";
import { loadProjectForStage } from "../_lib/load-stage";

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadProjectForStage(id, "script");
  return <StagePlaceholder stage="script" />;
}
