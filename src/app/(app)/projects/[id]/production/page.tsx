import { loadProduction } from "../_lib/load-production";

/**
 * Production opens at the screen that matches the shots: review, clips or the finished film
 * (`productionDestination`). Entering prepares the shots that need it, whatever the stage.
 */
export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadProduction(id, "entry");
  return null;
}
