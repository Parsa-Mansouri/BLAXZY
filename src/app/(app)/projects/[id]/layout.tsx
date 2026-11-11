import type { Metadata } from "next";
import { stageStep, stageViews } from "@/lib/stages";
import { Toolbar } from "@/ui";
import { loadProject } from "./_lib/load-project";
import { StageIndicator } from "./_components/stage-indicator";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  return { title: `${project.title} · BLAXZY` };
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  const stages = stageViews(project.stage, project.id).map((stage) => ({
    id: stage.key,
    label: stage.label,
    status: stage.status,
    href: stage.href,
    lockedHint: stage.lockedHint,
  }));

  return (
    <>
      <Toolbar
        title={project.title}
        leading={<StageIndicator step={stageStep(project.stage)} stages={stages} />}
      />
      <div className="px-(--content-x) pt-4 pb-16 shell:pt-8">{children}</div>
    </>
  );
}
