import { redirect } from "next/navigation";
import { currentStageHref } from "@/lib/stages";
import { loadProject } from "./_lib/load-project";

/** A project opens at its current stage. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  redirect(currentStageHref(project.id, project.stage));
}
