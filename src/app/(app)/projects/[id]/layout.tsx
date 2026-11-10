import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { stageViews } from "@/lib/stages";
import { Stepper } from "@/ui";
import { loadProject } from "./_lib/load-project";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProject(id);
  const steps = stageViews(project.stage).map((stage) => ({
    id: stage.key,
    label: stage.label,
    status: stage.status,
    lockedHint: stage.lockedHint,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 rounded-xs text-sm text-fg-muted focus-ring hover:text-fg [&_svg]:size-4"
        >
          <ArrowLeft aria-hidden="true" />
          All projects
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight break-words">{project.title}</h1>
      </div>
      <Stepper steps={steps} aria-label="Film progress" />
      {children}
    </div>
  );
}
