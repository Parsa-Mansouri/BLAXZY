import {
  continuityLedgerSchema,
  durationBudget,
  renderScreenplay,
  runDami,
  screenplaySceneSchema,
  scriptWriter,
  writerMaxTokens,
  writerProject,
  type ScreenplayScene,
  type SubmitScreenplay,
} from "../../src/server/damis";
import { defineHandler, enqueue, scriptWriteSegment } from "../../src/server/jobs";
import {
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  readScriptNotes,
  ScriptInputError,
  storeSegmentProgress,
  type SegmentProgress,
} from "../../src/server/script";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";
import { assumptionsOf, notesFor, stitchSegments } from "./script-writing";

/**
 * Long pieces: writes one sequence of the approved outline (write_segment) with the continuity
 * ledger and the last scene so far, stores the progress, then queues the next sequence. After the
 * last one it stitches the script (renumbering, canonical names, introductions) → in_review.
 */
export const scriptWriteSegmentHandler = defineHandler(
  scriptWriteSegment,
  async (payload, context) => {
    const { scriptVersionId: versionId, segmentIndex } = payload;
    const job = await loadScriptJob(versionId);
    if (!job || job.version.status !== "pending" || !job.isLatest) return;
    const { project, version } = job;
    const notes = readScriptNotes(version.damiNotes);
    const progress: SegmentProgress = notes.segmentProgress ?? {
      nextIndex: 0,
      scenes: [],
      ledger: null,
      warnings: [],
      assumptions: [],
      runIds: [],
    };
    if (progress.nextIndex === segmentIndex + 1) {
      // This sequence is stored already (a retry or duplicate): make sure the next one is queued
      // (a no-op while it is; progress stored before the next job was sent with it).
      await enqueue(scriptWriteSegment, {
        scriptVersionId: versionId,
        segmentIndex: segmentIndex + 1,
      });
      return;
    }
    if (progress.nextIndex !== segmentIndex) return; // a duplicate or stale job
    try {
      const style = project.style;
      if (!style) throw new ScriptInputError("Choose the project's style first.");
      const outline = notes.outline;
      if (!outline || !notes.outlineApproved) {
        throw new ScriptInputError("The approved outline is missing. Start again.");
      }
      const sequences = outline.acts.flatMap((a) => a.sequences);
      const sequence = sequences[segmentIndex];
      if (!sequence) throw new ScriptInputError("This part of the outline no longer exists.");

      const scenes = progress.scenes.map((s) => screenplaySceneSchema.parse(s));
      const ledger = progress.ledger ? continuityLedgerSchema.parse(progress.ledger) : null;
      const run = await runDami(
        scriptWriter,
        {
          mode: "write_segment",
          project: writerProject(style, sequence.target_seconds),
          approvedOutline: { ...outline, approved_additions: notes.approvedAdditions ?? [] },
          segmentId: sequence.id,
          continuityLedger: ledger,
          previousTail: scenes.at(-1) ?? null,
        },
        {
          userId: project.ownerId,
          projectId: project.id,
          signal: context.signal,
          maxOutputTokens: writerMaxTokens(sequence.target_seconds),
        },
      );
      const output: SubmitScreenplay = run.output;
      const allScenes: ScreenplayScene[] = [...scenes, ...output.screenplay.scenes];
      const next: SegmentProgress = {
        nextIndex: segmentIndex + 1,
        scenes: allScenes,
        ledger: output.continuity_ledger ?? ledger,
        warnings: [...progress.warnings, ...output.warnings],
        assumptions: [...progress.assumptions, ...assumptionsOf(output)],
        runIds: [...progress.runIds, run.runId],
      };

      if (segmentIndex + 1 < sequences.length) {
        // Stores the progress and queues the next sequence in one transaction.
        await storeSegmentProgress({ versionId, expectedIndex: segmentIndex, progress: next });
        return;
      }

      const { stored, warnings } = stitchSegments({
        title:
          outline.logline
            .split(/[.:!?]/)[0]
            ?.trim()
            .slice(0, 80) || "Untitled",
        logline: outline.logline,
        language: outline.language ?? output.screenplay.language,
        scenes: allScenes,
        canonicalCharacters: outline.canonical_names.characters,
      });
      const target = durationBudget(style.totalDurationSeconds, "").targetSeconds;
      await completeScriptVersion({
        versionId,
        content: renderScreenplay(stored).text,
        screenplay: stored,
        damiRunId: run.runId,
        notes: {
          ...notesFor({
            stored,
            outputs: [output],
            targetSeconds: target,
            assumptions: next.assumptions,
            extraWarnings: [...next.warnings, ...warnings],
          }),
          // Keep the outline for reference; the review screen shows the script.
          outline,
          outlineApproved: true,
        },
      });
    } catch (error) {
      await handleFailure(
        error,
        scriptWriteSegment,
        context,
        async (d) => {
          await failScriptVersion(versionId, d.message, d.runId);
        },
        classifyFailure,
      );
    }
  },
);
