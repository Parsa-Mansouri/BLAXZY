import { notFound, redirect } from "next/navigation";
import { BLOCK_ISSUE_LIST } from "@/server/damis";
import { getBlockDetail, MAX_BLOCK_ASSETS, MAX_REVIEW_NOTE_LENGTH } from "@/server/production";
import { loadProduction } from "../../../../_lib/load-production";
import { blockHref, shotMovedHref } from "../../../../_lib/production-routes";
import { BlockScreen } from "../../_components/block-screen";
import { findNeighbours, nextToReviewHref } from "../../_lib/navigation";

const BEFORE_CLIPS = ["preparing", "prepare_failed", "block_review", "approved"];

export default async function BlockPage({
  params,
}: {
  params: Promise<{ id: string; lineageId: string }>;
}) {
  const { id, lineageId } = await params;
  const { project, user } = await loadProduction(id, {
    screen: null,
    href: (projectId) => blockHref(projectId, lineageId),
  });
  const detail = await getBlockDetail(lineageId, user.id);
  if (!detail) notFound();
  // Once a shot has a clip in the works, its review is on its clip page (which always shows).
  if (!BEFORE_CLIPS.includes(detail.stage)) redirect(shotMovedHref(project.id, lineageId));
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
      nextToReviewHref={nextReview}
      issues={BLOCK_ISSUE_LIST.map(({ code, label, hint }) => ({ code, label, hint }))}
      maxNote={MAX_REVIEW_NOTE_LENGTH}
      maxAssets={MAX_BLOCK_ASSETS}
    />
  );
}
