import type { Metadata } from "next";
import { PROJECT_STAGES, stageViews } from "@/lib/stages";
import { loadProject } from "./_lib/load-project";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  return { title: `${project.title} · BLAXZY` };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProject(id);
  const current = stageViews(project.stage).find((s) => s.status === "current");
  const stage = PROJECT_STAGES.find((s) => s.key === current?.key);

  // Placeholder: the stage builders replace this with the stage's own screen.
  return (
    <section aria-labelledby="stage-title" className="flex max-w-(--measure) flex-col gap-2">
      <h2 id="stage-title" className="text-large-title">
        {stage ? stage.label : "Finished"}
      </h2>
      <p className="text-reading text-label-2">
        {stage ? stage.summary : "Every stage of this film is complete."}
      </p>
      {stage ? (
        <p className="pt-6 text-body text-label-2">This stage is not available yet.</p>
      ) : null}
    </section>
  );
}
