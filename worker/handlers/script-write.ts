import {
  durationBudget,
  episodeCount,
  HARD_MAX_SECONDS,
  needsOutline,
  renderScreenplay,
  runDami,
  scriptOutliner,
  singleCallTarget,
  writerProject,
  type StoredScreenplay,
  type SubmitScreenplay,
} from "../../src/server/damis";
import { defineHandler, enqueue, scriptWrite, scriptWriteSegment } from "../../src/server/jobs";
import {
  completeOutline,
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  readScriptNotes,
  ScriptInputError,
} from "../../src/server/script";
import { creativeDnaForRun } from "./creative-bible";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";
import { assumptionsOf, generateFitted, notesFor, stitchEpisodes } from "./script-writing";

/**
 * Writes a script from the brief with Script Writer v0.2:
 * - a film up to 15 minutes: generate → estimate → up to two runtime revise passes → in_review
 *   (with a visible warning when the runtime is still outside the tolerance);
 * - a series: one generate call per episode (target = one episode), stitched in order;
 * - a film over 15 minutes: the outline goes to review first; once approved, the version is
 *   written sequence by sequence (`script.write-segment`).
 */
export const scriptWriteHandler = defineHandler(scriptWrite, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "pending" || !job.isLatest) return;
  const { project, version } = job;
  const run = { userId: project.ownerId, projectId: project.id, signal: context.signal };
  try {
    const style = project.style;
    if (!style) throw new ScriptInputError("Choose the project's style first.");
    if (!version.brief) throw new ScriptInputError("This version has no brief to write from.");
    const notes = readScriptNotes(version.damiNotes);

    // An approved outline: write (or carry on writing) its sequences.
    if (notes.outlineApproved && notes.outline) {
      await enqueue(scriptWriteSegment, {
        scriptVersionId: versionId,
        segmentIndex: notes.segmentProgress?.nextIndex ?? 0,
      });
      return;
    }

    const dna = await creativeDnaForRun({
      projectId: project.id,
      consumer: "script_writer",
      job: scriptWrite,
      payload,
    });
    if (dna.deferred) return;
    const { creativeDna } = dna;

    if (needsOutline(style)) {
      const target = style.totalDurationSeconds;
      const outline = await runDami(
        scriptOutliner,
        {
          project: writerProject(style, target),
          story: version.brief,
          ...(creativeDna ? { creativeDna } : {}),
          ...(notes.outlineFeedback ? { feedback: notes.outlineFeedback } : {}),
        },
        run,
      );
      const warnings =
        target > HARD_MAX_SECONDS
          ? [
              ...outline.output.warnings,
              "This runs longer than 90 minutes. Consider splitting it into parts.",
            ]
          : outline.output.warnings;
      await completeOutline({
        versionId,
        outline: { ...outline.output, warnings },
        damiRunId: outline.runId,
      });
      return;
    }

    const episodes = episodeCount(style);
    const target = singleCallTarget(style);
    const outputs: SubmitScreenplay[] = [];
    let lastRunId = "";
    for (let e = 1; e <= episodes; e++) {
      const base = writerProject(style, target);
      const previous = outputs.map((o, i) => `Episode ${i + 1}: ${o.screenplay.logline}`);
      const project =
        episodes > 1
          ? {
              ...base,
              projectNotes: [
                base.projectNotes,
                `This is episode ${e} of ${episodes}.`,
                ...(previous.length > 0 ? ["Earlier episodes:", ...previous] : []),
              ]
                .filter(Boolean)
                .join("\n")
                .slice(0, 4000),
            }
          : base;
      const written = await generateFitted(project, version.brief, run, creativeDna);
      outputs.push(written.output);
      lastRunId = written.runId;
    }
    const stored: StoredScreenplay =
      episodes > 1
        ? stitchEpisodes(outputs)
        : { screenplay: (outputs[0] as SubmitScreenplay).screenplay };
    const totalTarget = durationBudget(target, "").targetSeconds * episodes;
    await completeScriptVersion({
      versionId,
      content: renderScreenplay(stored).text,
      screenplay: stored,
      damiRunId: lastRunId,
      notes: notesFor({
        stored,
        outputs,
        targetSeconds: totalTarget,
        assumptions:
          episodes > 1
            ? outputs.flatMap((o, i) => assumptionsOf(o, `Episode ${i + 1}: `))
            : undefined,
      }),
    });
  } catch (error) {
    await handleFailure(
      error,
      scriptWrite,
      context,
      async (d) => {
        await failScriptVersion(versionId, d.message, d.runId);
      },
      classifyFailure,
    );
  }
});
