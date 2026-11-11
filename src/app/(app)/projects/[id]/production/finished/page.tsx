import { notFound } from "next/navigation";
import { listFinishedClips } from "@/server/production";
import { loadProduction } from "../../_lib/load-production";
import { finishedHref } from "../../_lib/production-routes";
import { FinishedScreen } from "./_components/finished-screen";

const PAGE_SIZE = 24;

export default async function FinishedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Shown once any clip is final: while the film is reopened, its final clips stay here.
  const { project, user, overview } = await loadProduction(id, {
    screen: "finished",
    href: finishedHref,
  });
  const page = await listFinishedClips(project.id, user.id, { limit: PAGE_SIZE });
  if (!page) notFound();

  return (
    <FinishedScreen
      projectId={project.id}
      initial={page.items}
      initialCursor={page.nextCursor}
      portrait={project.style?.orientation === "portrait"}
      complete={overview.phase === "finished"}
      projectStage={overview.projectStage}
      phase={overview.phase}
    />
  );
}
