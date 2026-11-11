import { PROJECT_STAGES } from "@/lib/stages";
import { loadProjectForStage } from "../_lib/load-stage";
import { StyleForm, type SavedStyle } from "./_components/style-form";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "style");
  const info = PROJECT_STAGES[0];
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
    <section aria-labelledby="stage-title" className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h2 id="stage-title" className="text-large-title">
          {info.label}
        </h2>
        <p className="text-reading text-label-2">{info.summary}</p>
      </header>
      <StyleForm projectId={project.id} saved={saved} pastStyleStage={project.stage !== "style"} />
    </section>
  );
}
