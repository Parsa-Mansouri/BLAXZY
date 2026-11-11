import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { loadProjectForStage } from "../../../_lib/load-stage";
import { ClipReviewFrame } from "../_components/clip-review-frame";
import { BOARD_PAGE_SIZE, readBoard } from "../_lib/clip-data";

/**
 * The clip review: the header and the list of shots stay while the user moves from shot to
 * shot; only the clip in the focus area changes.
 */
export default async function ClipReviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "production");
  const user = await requireUser();
  const board = await readBoard(project.id, user.id, null, BOARD_PAGE_SIZE);
  if (!board) notFound();

  return (
    <ClipReviewFrame projectId={project.id} initial={board}>
      {children}
    </ClipReviewFrame>
  );
}
