import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { BLOCK_ISSUE_LIST } from "@/server/damis";
import { getBlockDetail, MAX_BLOCK_ASSETS, MAX_REVIEW_NOTE_LENGTH } from "@/server/production";
import { loadProjectForStage } from "../../../_lib/load-stage";
import { clipsHref, finishedHref } from "../../../_lib/production-routes";
import { BlockScreen } from "../_components/block-screen";
import { findNeighbours, nextToReviewHref } from "../_lib/navigation";

const BEFORE_CLIPS = ["preparing", "prepare_failed", "block_review", "approved"];

export default async function BlockPage({
  params,
}: {
  params: Promise<{ id: string; lineageId: string }>;
}) {
  const { id, lineageId } = await params;
  const project = await loadProjectForStage(id, "production");
  if (project.stage === "done") redirect(finishedHref(project.id));
  const user = await requireUser();
  const detail = await getBlockDetail(lineageId, user.id);
  if (!detail) notFound();
  // Once a shot has a clip in the works, its review is on the clips screens.
  if (!BEFORE_CLIPS.includes(detail.stage)) redirect(clipsHref(project.id));
  const neighbours = await findNeighbours(project.id, user.id, lineageId);
  if (!neighbours) notFound();
  const nextReview = await nextToReviewHref(
    project.id,
    user.id,
    detail.orderIndex,
    detail.lineageId,
  );

  const { takes: _takes, ...block } = detail;
  void _takes;
  return (
    <BlockScreen
      projectId={project.id}
      block={block}
      position={neighbours.position}
      previousHref={neighbours.previousHref}
      nextHref={neighbours.nextHref}
      nextToReviewHref={nextReview}
      issues={BLOCK_ISSUE_LIST.map(({ code, label, hint }) => ({ code, label, hint }))}
      maxNote={MAX_REVIEW_NOTE_LENGTH}
      maxAssets={MAX_BLOCK_ASSETS}
    />
  );
}
