import { PageHeader } from "@/ui";
import { loadProjectForStage } from "../_lib/load-stage";
import { StyleForm, type SavedStyle } from "./_components/style-form";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "style");
  const saved: SavedStyle | null = project.style
    ? {
        visualStyle: project.style.visualStyle,
        genre: project.style.genre,
        format: project.style.format,
        orientation: project.style.orientation,
        totalDurationSeconds: project.style.totalDurationSeconds,
        episodeDurationSeconds: project.style.episodeDurationSeconds ?? null,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Style"
        description="Five choices that set how the film looks and how long it runs."
      />
      <StyleForm projectId={project.id} saved={saved} pastStyleStage={project.stage !== "style"} />
    </>
  );
}
