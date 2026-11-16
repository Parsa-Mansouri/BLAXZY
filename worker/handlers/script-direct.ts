import { detectorView, loadDetectorState } from "../../src/server/assets";
import { latestDetectionAt } from "../../src/server/assets/jobs";
import { hasCurrentBlocksFor, setSectioningState } from "../../src/server/blocks";
import {
  defaultPlatformConfig,
  director,
  directorPlan,
  isBlocked,
  runDami,
  stubCreativeBible,
  type DirectorOutput,
  type DirectorPlanOutput,
} from "../../src/server/damis";
import {
  blockLengthFor,
  blockModeFor,
  estimateBlockCount,
  failDirection,
  FULL_MODE_MAX_BLOCKS,
  registryFromView,
  saveFull,
  savePlan,
  startDirection,
  supersedeDirection,
  type DirectionContext,
} from "../../src/server/direction";
import { defineHandler, scriptDirect } from "../../src/server/jobs";
import { reopenProductionAfterScriptEdit } from "../../src/server/production";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { creativeBibleForRun } from "./creative-bible";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";

/**
 * Directs the accepted script with the Director (owner v1.3): the blocks arrive with staging,
 * shots, rationales and a self-contained prompt. Up to ~8 blocks it is one `full` call whose
 * blocks are stored here; a longer script is a `plan` call whose plan is stored with one
 * `direction.write` job per batch (`direction-write.ts`), and the last batch stores the blocks.
 * Skips a version that is no longer the accepted one, and defers while the Creative Bible is
 * still compiling. A project without a bible gets the stub bible (`stubCreativeBible`).
 *
 * One run per version (and kind) at a time. A correction round that applies a new detection while
 * the Director runs queues a re-direction that is dropped, so the run is made once more here with
 * the new list instead of storing blocks that name the old one.
 */
export const scriptDirectHandler = defineHandler(scriptDirect, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "accepted") return;
  const { project, version } = job;
  if (!payload.resection && (await hasCurrentBlocksFor(project.id, versionId))) {
    await reopenProductionAfterScriptEdit(project.id);
    await setSectioningState({
      projectId: project.id,
      state: "done",
      scriptVersionId: versionId,
      failure: null,
      onlyFor: versionId,
    });
    return;
  }
  let directionId: string | null = null;
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!version.content) throw new ScriptInputError("The accepted script has no text.");
    const style = project.style;
    const script = version.content;
    const ready = await creativeBibleForRun({
      projectId: project.id,
      consumer: "director",
      job: scriptDirect,
      payload,
    });
    if (ready.deferred) return;
    const bible = ready.bible?.bible ?? null;
    const runContext = { userId: project.ownerId, projectId: project.id, signal: context.signal };
    const blockLengthSec = blockLengthFor(bible, defaultPlatformConfig().default_block_length_sec);
    const planned = estimateBlockCount({ style, script, blockLengthSec });
    const mode = planned <= FULL_MODE_MAX_BLOCKS ? "full" : "plan";

    const attempt = async () => {
      const detectedAt = await latestDetectionAt(project.id);
      const state = await loadDetectorState(project.id);
      const view = detectorView(state.rows, state.latest?.sceneIndex ?? [], "full");
      const { registry, bindings } = registryFromView(view);
      const directorContext: DirectionContext = {
        platform_config: defaultPlatformConfig(),
        block_mode: blockModeFor(bible),
        creative_bible: bible ?? stubCreativeBible(style),
        asset_registry: registry,
        bindings,
      };
      const id = await startDirection({
        projectId: project.id,
        scriptVersionId: versionId,
        creativeBibleId: ready.bible?.id ?? null,
        mode,
        context: directorContext,
      });
      directionId = id;
      const input = {
        platform_config: directorContext.platform_config,
        block_mode: directorContext.block_mode,
        creative_bible: directorContext.creative_bible,
        asset_registry: directorContext.asset_registry,
        script,
      };
      const run =
        mode === "full"
          ? await runDami(director, { mode: "full" as const, ...input }, runContext)
          : await runDami(directorPlan, { mode: "plan" as const, ...input }, runContext);
      const latest = await latestDetectionAt(project.id);
      const changed = latest !== null && (detectedAt === null || latest > detectedAt);
      return { id, run, changed };
    };
    const first = await attempt();
    const { id, run } = first.changed ? await attempt() : first;

    const output: DirectorOutput | DirectorPlanOutput = run.output;
    if (isBlocked(output)) {
      const reason = output.warnings.map((w) => w.message).join(" ");
      throw new ScriptInputError(
        `The Director could not start: ${reason || "the style notes were rejected."}`,
      );
    }
    const current = await loadScriptJob(versionId);
    if (current?.version.status !== "accepted") {
      await supersedeDirection(id); // edited again meanwhile
      return;
    }
    if (mode === "full") {
      const stored = await saveFull({
        directionId: id,
        output: output as DirectorOutput,
        runId: run.runId,
      });
      if (!stored.stored) return; // superseded by a newer run
      if (stored.assembled && !stored.replaced.skipped) {
        await reopenProductionAfterScriptEdit(project.id);
      } else if (stored.assembled) {
        // A newer version was accepted meanwhile: its own run stores the blocks.
        console.info(
          `[script.direct] blocks of ${versionId} not stored: it is not the newest accepted version`,
        );
      }
      return;
    }
    await savePlan({ directionId: id, plan: output as DirectorPlanOutput, runId: run.runId });
  } catch (error) {
    await handleFailure(
      error,
      scriptDirect,
      context,
      async (d) => {
        if (directionId) await failDirection(directionId, d.message, d.runId);
        await setSectioningState({
          projectId: project.id,
          state: "failed",
          scriptVersionId: versionId,
          failure: d.message,
          onlyFor: versionId,
        });
      },
      classifyFailure,
    );
  }
});
