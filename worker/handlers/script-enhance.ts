import { ownerGenreName, ownerStyleName } from "../../src/lib/style-options";
import {
  enhancer,
  OWNER_ENHANCER_GENRES,
  OWNER_ENHANCER_STYLES,
  runDami,
  type EnhancerOutput,
} from "../../src/server/damis";
import { mergeDamiStyle } from "../../src/server/projects";
import { defineHandler, isShutdownAbort, scriptEnhance } from "../../src/server/jobs";
import { errorMessage, logLine } from "../../src/server/jobs/log";
import {
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  ScriptInputError,
} from "../../src/server/script";
import { isLastAttempt, TOOK_TOO_LONG } from "./failure";
import { classifyFailure } from "./script-failure";

function ownerChoice<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** The owner: max_tokens ≈ 2.5 × input tokens + 500 (about 1.4 tokens a word), within bounds. */
export function enhancerMaxTokens(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.min(16_000, Math.max(2_000, Math.round(2.5 * words * 1.4 + 500)));
}

/**
 * Rewrites the user's quick idea with the Enhancer: the enhanced prose becomes the version's
 * content and its look line goes to the project's style. A typed ("Other") genre or style is
 * sent as inactive. If the dami fails (after the queue's retries, or with status "error"), the
 * user's own text is kept and the review screen says so; the version never fails for it.
 */
export const scriptEnhanceHandler = defineHandler(scriptEnhance, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "pending" || !job.isLatest) return;
  const { project, version } = job;
  const idea = version.brief ?? "";
  if (!project.style || !idea.trim()) {
    await failScriptVersion(
      versionId,
      new ScriptInputError("This version has no idea to work from.").message,
    );
    return;
  }
  const genre = ownerChoice(ownerGenreName(project.style.genre), OWNER_ENHANCER_GENRES);
  const visualStyle = ownerChoice(ownerStyleName(project.style.visualStyle), OWNER_ENHANCER_STYLES);

  let output: EnhancerOutput | null = null;
  let runId: string | null = null;
  try {
    const run = await runDami(
      enhancer,
      { userPrompt: idea, genre, visualStyle },
      {
        userId: project.ownerId,
        projectId: project.id,
        signal: context.signal,
        maxOutputTokens: enhancerMaxTokens(idea),
      },
    );
    output = run.output;
    runId = run.runId;
  } catch (error) {
    // A shutdown is not a failure: the job runs again.
    if (isShutdownAbort(context.signal)) throw error;
    const last = isLastAttempt(scriptEnhance, context);
    // An expired attempt (or an aborted dami) is retried; on the last one the user's text is
    // kept like after any failure.
    const decision = context.signal.aborted
      ? { message: TOOK_TOO_LONG, retryable: true }
      : classifyFailure(error);
    if (decision.retryable && !last) throw error;
    logLine("warn", "keeping the user's text", {
      job: scriptEnhance.name,
      id: context.jobId,
      attempt: context.attempt,
      versionId,
      failure: decision.message,
      error: errorMessage(error),
    });
  }

  if (output?.status === "ok" && output.enhanced_prompt) {
    if (output.look_line) await mergeDamiStyle(project.id, { lookLine: output.look_line });
    await completeScriptVersion({
      versionId,
      content: output.enhanced_prompt,
      damiRunId: runId,
      notes: {
        enhance: { lookLine: output.look_line, overrides: output.overrides, fellBack: false },
        ...(output.overrides.length > 0 ? { notes: output.overrides } : {}),
      },
    });
    return;
  }
  await keepUserIdea(versionId, idea, runId);
});

/**
 * The Enhancer gave up (or its job was lost): the user's own idea becomes the version's content
 * and the review screen says so. Only a pending version changes; true when this call did it.
 */
export function keepUserIdea(
  versionId: string,
  idea: string,
  damiRunId: string | null,
): Promise<boolean> {
  return completeScriptVersion({
    versionId,
    content: idea,
    damiRunId,
    notes: { enhance: { lookLine: null, overrides: [], fellBack: true } },
  });
}
