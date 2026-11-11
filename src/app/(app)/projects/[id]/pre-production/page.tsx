import { notFound } from "next/navigation";
import { listAssets, type Asset } from "@/server/assets";
import { requireUser } from "@/server/auth";
import { listBlocks } from "@/server/blocks";
import { getScriptState } from "@/server/script";
import { Hint } from "@/ui";
import { ASSET_KIND_LABELS } from "../_lib/asset-kinds";
import { loadBackgroundStatus } from "../_lib/background-status";
import { loadProjectForStage } from "../_lib/load-stage";
import { PreProductionPoller, ShotList } from "./_components/shots";
import { SHOT_PAGE_SIZE, toShotRow } from "./_components/shot-types";

const ASSETS_PER_KIND = 200;

function AssetGroup({ title, assets, more }: { title: string; assets: Asset[]; more: boolean }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline gap-2.5 px-3">
        <h3 className="text-title-1">{title}</h3>
        <span className="font-normal text-title-3 text-label-2 tabular-nums">{assets.length}</span>
      </div>
      <ul className="flex flex-col rounded-group bg-elevated">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="relative flex flex-col gap-0.5 px-3 py-2.5 before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-(--hairline) before:bg-separator first:before:hidden"
          >
            <span className="text-body font-medium text-label">{asset.name}</span>
            {asset.description ? (
              <span className="text-callout text-pretty text-label-2">{asset.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {more ? (
        <p className="px-3 text-callout text-label-2">Showing the first {assets.length}.</p>
      ) : null}
    </section>
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

  const kinds = ASSET_KIND_LABELS.filter(({ kind }) => status.counts[kind] > 0);
  const [groups, blocks] = await Promise.all([
    Promise.all(
      kinds.map(async ({ kind, plural }) => {
        const page = await listAssets(project.id, user.id, { kind, limit: ASSETS_PER_KIND });
        return { kind, plural, items: page?.items ?? [], more: Boolean(page?.nextCursor) };
      }),
    ),
    listBlocks(project.id, user.id, { limit: SHOT_PAGE_SIZE }),
  ]);
  const totalAssets = kinds.reduce((n, { kind }) => n + status.counts[kind], 0);
  const running = status.state === "running";

  return (
    <div className="@container flex flex-col gap-12">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-large-title">Pre-production</h2>
          <p className="max-w-(--measure) text-reading text-label-2">
            Everything the film needs to stay consistent, found in the accepted script, and the
            shots it is cut into.
          </p>
        </div>
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

      {totalAssets > 0 ? (
        <div className="grid items-start gap-x-10 gap-y-12 @4xl:grid-cols-2">
          {groups.map((group) => (
            <AssetGroup
              key={group.kind}
              title={group.plural}
              assets={group.items}
              more={group.more}
            />
          ))}
        </div>
      ) : !running ? (
        <p className="text-reading text-label-2">
          No characters, places or props were found in the script.
        </p>
      ) : null}

      <section aria-labelledby="shots-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2.5">
            <h3 id="shots-title" className="text-title-1">
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

      <Hint>Adding images to characters, places and props comes in a later release.</Hint>
    </div>
  );
}
