import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listBlocks } from "@/server/blocks";
import { getScriptState } from "@/server/script";
import { stageHref } from "@/lib/stages";
import { Button, PageHeader } from "@/ui";
import { reviewHref } from "../_lib/asset-kinds";
import { loadBackgroundStatus } from "../_lib/background-status";
import { loadProjectForStage } from "../_lib/load-stage";
import { CategoryFeature, CategoryTile } from "./_components/category-tile";
import { ContinueToProduction } from "./_components/continue-to-production";
import { OverviewPoller } from "./_components/overview-poller";
import { PreProductionPoller, ShotList } from "./_components/shots";
import { SHOT_PAGE_SIZE, toShotRow } from "./_components/shot-types";
import { loadCategories, type OverviewCategory } from "./_lib/load-categories";

/** True when something in the category waits for the user. */
function needsUser(category: OverviewCategory): boolean {
  return category.assets.some(
    (a) => a.stage !== "ready" && a.stage !== "generating" && a.stage !== "building_sheet",
  );
}

export default async function PreProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await loadProjectForStage(id, "pre_production");
  const user = await requireUser();
  const script = await getScriptState(project.id, user.id);
  if (!script) notFound();
  const status = await loadBackgroundStatus(project.id, user.id, script.accepted?.id ?? null);
  if (!status) notFound();
  const [overview, blocks] = await Promise.all([
    loadCategories(project.id, user.id),
    listBlocks(project.id, user.id, { limit: SHOT_PAGE_SIZE }),
  ]);
  if (!overview) notFound();

  const running = status.state === "running";
  const hasAssets = overview.total > 0;
  // Once the project has moved on, Pre-production is finished: the way on is Production.
  const moved = project.stage !== "pre_production";
  const allReady = hasAssets && overview.ready === overview.total;
  const hasSheets = overview.categories.some((c) =>
    c.assets.some((a) => a.stage === "ready" || a.stage === "sheet_review"),
  );
  // The leading category is the first one that waits for the user; the others stay quieter.
  const leading = overview.categories.find(needsUser) ?? overview.categories[0] ?? null;
  const others = overview.categories.filter((c) => c !== leading);

  const description = moved
    ? "Pre-production is complete."
    : allReady
      ? "Every asset is ready."
      : "Give every character, location, prop and voice its look.";

  const reviewButton = hasSheets ? (
    <Button variant="outlined" size="large" render={<Link href={reviewHref(project.id)} />}>
      Review Sheets
    </Button>
  ) : null;

  return (
    <div className="flex flex-col">
      <OverviewPoller projectId={project.id} busy={overview.busy} signature={overview.signature} />
      <PageHeader
        title="Pre-production"
        description={description}
        actions={
          moved ? (
            <>
              {reviewButton}
              <Button
                variant="primary"
                size="large"
                render={<Link href={stageHref(project.id, "production")} />}
              >
                Continue to Production
              </Button>
            </>
          ) : overview.canComplete ? (
            <>
              {reviewButton}
              <ContinueToProduction projectId={project.id} />
            </>
          ) : (
            reviewButton
          )
        }
      />

      <PreProductionPoller
        projectId={project.id}
        state={status.state}
        blockCount={status.blockCount}
      />
      {status.state === "failed" ? (
        <p role="alert" className="mb-8 max-w-(--measure) in-2 text-body text-label">
          The shots could not be prepared. {status.failure}{" "}
          <span className="text-label-2">Open the Script stage to try again.</span>
        </p>
      ) : null}

      {leading ? (
        <div className="flex in-2 flex-col gap-3">
          <CategoryFeature projectId={project.id} category={leading} />
          {others.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
              {others.map((category, i) => (
                <CategoryTile
                  key={category.kind}
                  projectId={project.id}
                  category={category}
                  index={i}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : !running ? (
        <p className="max-w-(--measure) in-2 text-body text-label-2">
          No characters, places or props were found in the script. Change the script to bring them
          in.
        </p>
      ) : null}

      {!moved && !overview.canComplete && hasAssets ? (
        <div className="mt-8 flex in-3 flex-wrap items-center gap-x-3 gap-y-2 pt-6 hairline-t">
          <Lock aria-hidden="true" strokeWidth={1.5} className="size-4 text-label-2" />
          <span className="text-body font-medium text-label-2">Production</span>
          <span className="text-secondary text-label-2">Opens when every asset is ready.</span>
        </div>
      ) : null}

      <section aria-labelledby="shots-title" className="mt-12 flex in-3 flex-col gap-2">
        <h2 id="shots-title" className="text-section">
          Shots
        </h2>
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
