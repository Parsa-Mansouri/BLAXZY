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
 * the page in a full-height flex column. Pages start with a PageHeader, which holds the h1.
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
      {/*
        A flex column that fills the height under the toolbar: a stage page that is one
        composition gives its main region `flex-1` (or uses FocusLayout `fill`) to use it.
      */}
      <div className="flex flex-1 flex-col px-(--content-x) pt-8 pb-10">{children}</div>
    </ProjectChrome>
  );
}
