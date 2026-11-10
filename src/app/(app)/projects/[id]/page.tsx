import type { Metadata } from "next";
import { Card, CardHeader } from "@/ui";
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

  // Placeholder: the stage builders replace this card with the real stage UI.
  return (
    <Card padding="lg">
      {stage ? (
        <CardHeader
          title={`${stage.label} questions arrive here next`}
          description={stage.summary}
        />
      ) : (
        <CardHeader title="Every stage is complete" description="Your film is finished." />
      )}
    </Card>
  );
}
