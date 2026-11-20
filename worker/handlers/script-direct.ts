import { detectorView, loadDetectorState } from "../../src/server/assets";
import { latestDetectionAt } from "../../src/server/assets/jobs";
import { hasCurrentBlocksFor, setSectioningState } from "../../src/server/blocks";
import {
  cinematographer,
  cinematographerBible,
  defaultPlatformConfig,
  filmDirector,
  isBlocked,
  runDami,
  stubCreativeBible,
  type ShotPlan,
} from "../../src/server/damis";
import {
  blockModeFor,
  failDirection,
  lookScenesFor,
  pickCraft,
  registryFromView,
  saveShotPlan,
  startDirection,
  startLighting,
  supersedeDirection,
  type DirectionContext,
} from "../../src/server/direction";
import { defineHandler, scriptDirect } from "../../src/server/jobs";
import { reopenProductionAfterScriptEdit } from "../../src/server/production";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { creativeBibleForRun } from "./creative-bible";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";

/** The user-facing reason a run cannot start: the Director refused the style notes. */
const COULD_NOT_START = "The Director could not start";

/**
 * Directs the accepted script with the craft pipeline. Here: the director and cinematographer are
 * picked (`pickCraft`, frozen into the run), the film-director plans the shots (`ShotPlan`) and the
 * cinematographer sets the film's look; the run then becomes `lighting` with one `direction.scene`
 * job per batch of scenes (`direction-scene.ts`). The last scene batch runs the Breakdown and
 * queues the `direction.write` batches (`direction-write.ts`), whose last batch stores the blocks.
 *
 * Skips a version that is no longer the accepted one, and defers while the Creative Bible is still
 * compiling. A project without a bible gets the stub bible (`stubCreativeBible`). Shot-by-shot
 * clips cannot be written yet, so a style asking for them fails with a clear reason.
 *
 * One run per version (and kind) at a time. A correction round that applies a new detection while
 * the film-director runs queues a re-direction that is dropped, so the run is made once more here
 * with the new list instead of storing shots that name the old one.
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
    if (style.blockLength === "shot") {
      throw new ScriptInputError(
        "Shot-by-shot clips cannot be directed yet. Choose 15 or 30 second blocks in the Style step and try again.",
      );
    }
    const script = version.content;
    const ready = await creativeBibleForRun({
      projectId: project.id,
      consumer: "director",
      job: scriptDirect,
      payload,
    });
    if (ready.deferred) return;
    const bible = ready.bible?.bible ?? null;
    const creativeBible = bible ?? stubCreativeBible(style);
    if (creativeBible.validation_status === "rejected") {
      throw new ScriptInputError(
        `${COULD_NOT_START}: the Creative Bible of this style was rejected. Adjust the style and try again.`,
      );
    }
    const runContext = { userId: project.ownerId, projectId: project.id, signal: context.signal };
    const craft = pickCraft(style, bible);
    const blockMode = blockModeFor(bible, style);

    const attempt = async () => {
      const detectedAt = await latestDetectionAt(project.id);
      const state = await loadDetectorState(project.id);
      const view = detectorView(state.rows, state.latest?.sceneIndex ?? [], "full");
      const { registry, bindings } = registryFromView(view);
      const directorContext: DirectionContext = {
        platform_config: defaultPlatformConfig(),
        block_mode: blockMode,
        creative_bible: creativeBible,
        asset_registry: registry,
        bindings,
        craft,
      };
      const id = await startDirection({
        projectId: project.id,
        scriptVersionId: versionId,
        creativeBibleId: ready.bible?.id ?? null,
        mode: "craft",
        context: directorContext,
        craft,
      });
      directionId = id;
      const run = await runDami(
        filmDirector,
        {
          director_id: craft.directorId,
          block_mode: blockMode,
          creative_bible: creativeBible,
          asset_registry: registry,
          script,
        },
        runContext,
      );
      const latest = await latestDetectionAt(project.id);
      const changed = latest !== null && (detectedAt === null || latest > detectedAt);
      return { id, run, changed, registry };
    };
    const first = await attempt();
    const { id, run, registry } = first.changed ? await attempt() : first;

    const shotPlan: ShotPlan = run.output;
    if (isBlocked(shotPlan)) {
      const reason = shotPlan.warnings.map((w) => w.message).join(" ");
      throw new ScriptInputError(
        `${COULD_NOT_START}: ${reason || "the script could not be directed."}`,
      );
    }
    const current = await loadScriptJob(versionId);
    if (current?.version.status !== "accepted") {
      await supersedeDirection(id); // edited again meanwhile
      return;
    }
    if (!(await saveShotPlan({ directionId: id, shotPlan, runId: run.runId }))) return;

    const look = await runDami(
      cinematographer,
      {
        mode: "look",
        cinematographer_id: craft.cinematographerId,
        creative_bible: cinematographerBible(creativeBible),
        scenes: lookScenesFor(shotPlan, registry),
      },
      runContext,
    );
    if (look.output.mode !== "look")
      throw new Error("The cinematographer answered the wrong mode.");
    await startLighting({ directionId: id, look: look.output.look, runId: look.runId });
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
