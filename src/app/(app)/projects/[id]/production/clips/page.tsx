import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { loadProject } from "../../_lib/load-project";
import { loadProjectForStage } from "../../_lib/load-stage";
import { ClipsBoard } from "./_components/clips-board";
import { BOARD_PAGE_SIZE, readBoard } from "./_lib/clip-data";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const project = await loadProject(id);
  return { title: `Clips · ${project.title} · BLAXZY` };
}

/** Every shot of the film as a poster tile, in story order, with the one next step. */
export default async function ClipsPage({ params }: { params: Params }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "production");
  const user = await requireUser();
  const board = await readBoard(project.id, user.id, null, BOARD_PAGE_SIZE);
  if (!board) notFound();

  return (
    <ClipsBoard
      projectId={project.id}
      orientation={project.style?.orientation ?? "landscape"}
      initial={board}
    />
  );
}
