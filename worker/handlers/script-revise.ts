import {
  durationBudget,
  isWriterReasonCode,
  issueTypeFor,
  parseStoredScreenplay,
  renderScreenplay,
  REVISE_RUN_SETTINGS,
  runDami,
  SCRIPT_ISSUE_CODES,
  sceneNumberAt,
  scriptReviser,
  scriptWriter,
  singleCallTarget,
  writerMaxTokens,
  writerProject,
  writerReason,
  type EpisodeMarker,
  type ScriptIssueCode,
  type StoredScreenplay,
  type WriterReasonCode,
} from "../../src/server/damis";
import type { ProjectStyle, ReviewComment } from "../../src/server/db/schema";
import { defineHandler, scriptRevise } from "../../src/server/jobs";
import {
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  readScriptNotes,
  ScriptInputError,
  type ScriptJobContext,
} from "../../src/server/script";
import { handleFailure } from "./script-failure";
import { notesFor } from "./script-writing";

function isIssueCode(code: string): code is ScriptIssueCode {
  return (SCRIPT_ISSUE_CODES as readonly string[]).includes(code);
}

/** Writer reason codes the script-reviser knows under its own name (uploaded scripts). */
const REVISER_CODE_FOR: Partial<Record<WriterReasonCode, ScriptIssueCode>> = {
  too_long: "too_long",
  too_short: "too_short",
  dialogue_unnatural: "dialogue_unnatural",
  format_error: "formatting",
  impossible_action: "hard_to_film",
  contains_camera_or_prompt_language: "hard_to_film",
  simplify: "too_many_characters",
  different_ending_tone: "ending_weak",
};

/** Each anchored comment as a quoted line of the custom note. */
function commentLines(comments: ReviewComment[]): string[] {
  return comments.map((c) => `On "${c.quote.replace(/\s+/g, " ").trim()}": ${c.note}`);
}

/** Episode markers survive a revise when their first scenes still exist. */
function keepEpisodes(
  episodes: EpisodeMarker[] | undefined,
  sceneNumbers: number[],
): EpisodeMarker[] | undefined {
  if (!episodes) return undefined;
  const present = new Set(sceneNumbers);
  const kept = episodes.filter((e) => present.has(e.firstScene));
  return kept.length > 0 ? kept : undefined;
}

function runtimeTarget(style: ProjectStyle, stored: StoredScreenplay): number {
  const per = durationBudget(singleCallTarget(style), "").targetSeconds;
  return stored.episodes ? per * stored.episodes.length : per;
}

/** A generated parent: the writer's revise mode, with the review as the owner's feedback block. */
async function reviseWithWriter(
  job: ScriptJobContext,
  parentStored: StoredScreenplay,
  style: ProjectStyle,
  signal: AbortSignal,
): Promise<void> {
  const { project, version, review } = job;
  if (!review) throw new ScriptInputError("The review this revision answers is missing.");
  const rendered = renderScreenplay(parentStored);
  const reasons = review.issueCodes.filter(isWriterReasonCode);
  const others = review.issueCodes.filter((c) => !isWriterReasonCode(c));
  // Comments are quotes in the note; their scenes become the scope when nothing else is asked.
  const scope = [
    ...new Set(
      review.comments
        .map((c) => sceneNumberAt(rendered, c.start))
        .filter((n): n is number => n !== null),
    ),
  ].sort((a, b) => a - b);
  const useScope = scope.length > 0 && reasons.length === 0 && !review.note;
  const customNote = [review.note ?? "", ...others, ...commentLines(review.comments)]
    .filter(Boolean)
    .join("\n");
  const target = runtimeTarget(style, parentStored);
  const run = await runDami(
    scriptWriter,
    {
      mode: "revise",
      project: writerProject(style, target),
      previousScreenplay: parentStored.screenplay,
      feedback: {
        issueType: issueTypeFor(reasons),
        selectedReasons: reasons,
        ...(customNote ? { customNote: customNote.slice(0, 20_000) } : {}),
        ...(useScope ? { scope } : {}),
      },
    },
    {
      userId: project.ownerId,
      projectId: project.id,
      signal,
      ...REVISE_RUN_SETTINGS,
      maxOutputTokens: writerMaxTokens(target),
    },
  );
  const scenes = run.output.screenplay.scenes;
  const stored: StoredScreenplay = {
    screenplay: run.output.screenplay,
    episodes: keepEpisodes(
      parentStored.episodes,
      scenes.map((s) => s.scene_number),
    ),
  };
  await completeScriptVersion({
    versionId: version.id,
    content: renderScreenplay(stored).text,
    screenplay: stored,
    damiRunId: run.runId,
    notes: notesFor({ stored, outputs: [run.output], targetSeconds: target }),
  });
}

/**
 * Revises the rejected parent from its review. A generated parent (it has a structured
 * screenplay) goes through the Script Writer's revise mode; uploaded, edited and enhanced ones
 * keep the script-reviser (the writer's reason codes are mapped to its issues or sent as notes).
 */
export const scriptReviseHandler = defineHandler(scriptRevise, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "pending" || !job.isLatest) return;
  const { project, parent, review } = job;
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!parent?.content || !review) {
      throw new ScriptInputError("The review this revision answers is missing. Start again.");
    }
    const parentStored = parseStoredScreenplay(parent.screenplay);
    if (parentStored) {
      await reviseWithWriter(job, parentStored, project.style, context.signal);
      return;
    }
    const mapped = new Set<ScriptIssueCode>(review.issueCodes.filter(isIssueCode));
    const unmapped: string[] = [];
    for (const code of review.issueCodes) {
      if (!isWriterReasonCode(code)) continue;
      const known = REVISER_CODE_FOR[code];
      if (known) mapped.add(known);
      else unmapped.push(writerReason(code).instruction);
    }
    const note = [review.note ?? "", ...unmapped].filter(Boolean).join("\n");
    const run = await runDami(
      scriptReviser,
      {
        style: project.style,
        content: parent.content,
        review: {
          issueCodes: [...mapped],
          note: note || undefined,
          comments: review.comments,
        },
      },
      { userId: project.ownerId, projectId: project.id, signal: context.signal },
    );
    const parentNotes = readScriptNotes(parent.damiNotes);
    await completeScriptVersion({
      versionId,
      content: run.output.content,
      damiRunId: run.runId,
      notes: {
        title: parentNotes.title ?? null,
        logline: parentNotes.logline ?? null,
        ...(parentNotes.enhance ? { enhance: parentNotes.enhance } : {}),
        changeSummary: run.output.changeSummary,
        edits: run.output.edits,
      },
    });
  } catch (error) {
    await handleFailure(error, scriptRevise, context, async (d) => {
      await failScriptVersion(versionId, d.message, d.runId);
    });
  }
});
