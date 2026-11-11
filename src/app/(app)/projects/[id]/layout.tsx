import type { Metadata } from "next";
import { stageLabel, stageViews } from "@/lib/stages";
import { loadProject } from "./_lib/load-project";
import { LockedNotice } from "./_components/locked-notice";
import { ProjectChrome } from "./_components/project-chrome";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  return { title: `${project.title} · BLAXZY` };
}

/**
 * Inside a project: the toolbar (project name or back control, and the four-stage strip), then
 * the page. Pages start with a PageHeader, which holds the h1.
 */
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
    grow: stage.key === "pre_production" ? 1.5 : 1,
  }));

  return (
    <ProjectChrome projectId={project.id} title={project.title} stages={stages}>
      <LockedNotice stageLabel={stageLabel(project.stage)} />
      <div className="px-(--content-x) pt-8 pb-18">{children}</div>
    </ProjectChrome>
  );
}
