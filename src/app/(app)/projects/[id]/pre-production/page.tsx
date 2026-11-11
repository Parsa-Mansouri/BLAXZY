import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { listBlocks } from "@/server/blocks";
import { getScriptState } from "@/server/script";
import { stageHref } from "@/lib/stages";
import { Button, ProgressBar } from "@/ui";
import { readyWords, reviewHref } from "../_lib/asset-kinds";
import { loadBackgroundStatus } from "../_lib/background-status";
import { loadOverview } from "../_lib/load-overview";
import { loadProjectForStage } from "../_lib/load-stage";
import { CategoryTile } from "./_components/category-tile";
import { OverviewPoller } from "./_components/overview-poller";
import { PreProductionPoller, ShotList } from "./_components/shots";
import { SHOT_PAGE_SIZE, toShotRow } from "./_components/shot-types";

export default async function PreProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "pre_production");
  const user = await requireUser();
  const script = await getScriptState(project.id, user.id);
  if (!script) notFound();
  const status = await loadBackgroundStatus(project.id, user.id, script.accepted?.id ?? null);
  if (!status) notFound();
  const [overview, blocks] = await Promise.all([
    loadOverview(project.id, user.id),
    listBlocks(project.id, user.id, { limit: SHOT_PAGE_SIZE }),
  ]);
  if (!overview) notFound();

  const running = status.state === "running";
  const hasAssets = overview.total > 0;
  const allReady = hasAssets && overview.ready === overview.total;
  // Once the project has moved on, Pre-production is finished: the way on is Production.
  const moved = project.stage !== "pre_production";
  const percent = hasAssets ? (overview.ready / overview.total) * 100 : 0;
  const words = readyWords(overview.ready, overview.total);

  return (
    <div className="@container flex flex-col gap-12">
      <OverviewPoller projectId={project.id} busy={overview.busy} signature={overview.signature} />
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-large-title">Pre-production</h2>
            <p className="max-w-(--measure) text-reading text-label-2">
              {moved
                ? "Pre-production is complete. Continue to Production, or look through the sheets again."
                : allReady
                  ? "Every asset is ready. Look through the sheets once more, then continue."
                  : "Give every character, place and prop an image. Each one becomes a reference sheet."}
            </p>
          </div>
          {hasAssets ? (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              {moved ? (
                <>
                  <Button
                    variant="prominent"
                    size="large"
                    render={<Link href={stageHref(project.id, "production")} />}
                  >
                    Continue to Production
                  </Button>
                  <Button variant="standard" render={<Link href={reviewHref(project.id)} />}>
                    Review All Sheets
                  </Button>
                </>
              ) : allReady ? (
                <Button
                  variant="prominent"
                  size="large"
                  render={<Link href={reviewHref(project.id)} />}
                >
                  Review All Sheets
                </Button>
              ) : (
                <>
                  <Button
                    variant="prominent"
                    size="large"
                    disabled
                    aria-describedby="review-reason"
                  >
                    Review All Sheets
                  </Button>
                  <p id="review-reason" className="text-callout text-label-2">
                    Every asset has to be ready first.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
        {hasAssets ? (
          <div className="flex max-w-sm flex-col gap-2">
            <p className="text-title-2 tabular-nums">{words}</p>
            <ProgressBar
              value={percent}
              tone={allReady ? "success" : "default"}
              aria-label={`Pre-production: ${words}`}
            />
          </div>
        ) : null}
        <PreProductionPoller
          projectId={project.id}
          state={status.state}
          blockCount={status.blockCount}
        />
        {status.state === "failed" ? (
          <p role="alert" className="max-w-(--measure) text-body text-label">
            The shots could not be prepared. {status.failure}{" "}
            <span className="text-label-2">Open the Script stage to try again.</span>
          </p>
        ) : null}
      </header>

      {hasAssets ? (
        <section aria-label="Categories">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-x-6 gap-y-10">
            {overview.categories.map((category) => (
              <li key={category.kind} className="min-w-0">
                <CategoryTile projectId={project.id} category={category} />
              </li>
            ))}
          </ul>
        </section>
      ) : !running ? (
        <p className="max-w-(--measure) text-reading text-label-2">
          No characters, places or props were found in the script. Change the script to bring them
          in.
        </p>
      ) : null}

      <section aria-labelledby="shots-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2.5">
            <h3 id="shots-title" className="text-title-2">
              Shots
            </h3>
            <span className="font-normal text-title-3 text-label-2 tabular-nums">
              {status.blockCount}
            </span>
          </div>
          <p className="text-body text-label-2">
            {running
              ? status.blockCount > 0
                ? "The shots below are from the previous script. New ones are being prepared."
                : "The script is being cut into shots."
              : status.state === "stale"
                ? "Some shots no longer match the script. They are marked and will be prepared again."
                : status.blockCount > 0
                  ? "The script cut into shots, each with the prompt that will generate it."
                  : "No shots yet."}
          </p>
        </div>
        {blocks && blocks.items.length > 0 ? (
          <ShotList
            projectId={project.id}
            initial={blocks.items.map(toShotRow)}
            initialCursor={blocks.nextCursor}
          />
        ) : null}
      </section>
    </div>
  );
}
