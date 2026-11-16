import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import { quoteGeneration } from "@/server/generation";
import { getBlockDetail, MAX_REVIEW_NOTE_LENGTH, quoteProduction } from "@/server/production";
import { loadProject } from "../../../../_lib/load-project";
import { loadProduction } from "../../../../_lib/load-production";
import { clipHref } from "../../../../_lib/production-routes";
import { findNeighbours } from "../../_lib/clip-data";
import { shotTitle } from "../../_lib/clip-view";
import { ClipScreen } from "./_components/clip-screen";

type Params = Promise<{ id: string; lineageId: string }>;

/** The shot and its neighbours, when it is one of this project's shots; shared by metadata and page. */
const loadShot = cache(async (projectId: string, lineageId: string) => {
  const user = await requireUser();
  const [detail, neighbours] = await Promise.all([
    getBlockDetail(lineageId, user.id),
    findNeighbours(projectId, user.id, lineageId),
  ]);
  return detail && neighbours ? { detail, neighbours } : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, lineageId } = await params;
  const project = await loadProject(id);
  const shot = await loadShot(project.id, lineageId).catch(() => null);
  return {
    title: shot ? `${shotTitle(shot.detail)} · ${project.title} · BLAXZY` : undefined,
  };
}

export default async function ClipPage({ params }: { params: Params }) {
  const { id, lineageId } = await params;
  const { project, user } = await loadProduction(id, {
    screen: null,
    href: (projectId) => clipHref(projectId, lineageId),
  });
  const shot = await loadShot(project.id, lineageId);
  if (!shot) notFound();
  const { detail, neighbours } = shot;
  const style = project.style;
  const [quote, draftPrice, balance] = await Promise.all([
    quoteProduction(project.id, user.id).catch(() => null),
    style ? quoteGeneration({ purpose: "block_draft", style }).then((q) => q.priceCredits) : null,
    getBalance(user.id),
  ]);

  return (
    <ClipScreen
      projectId={project.id}
      orientation={style?.orientation ?? "landscape"}
      shot={detail}
      neighbours={neighbours}
      prices={{ draft: draftPrice, final: quote?.finalsEach ?? null }}
      balance={quote?.balance ?? balance}
      maxNote={MAX_REVIEW_NOTE_LENGTH}
    />
  );
}
