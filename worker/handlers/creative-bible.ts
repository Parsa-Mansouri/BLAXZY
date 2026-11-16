/**
 * How a job that runs a Creative Bible consumer gets its bible (see `bibleForRun`): a ready bible
 * becomes the dami's `creativeDna` block; a bible still compiling defers the job (a delayed copy
 * of itself, `bibleWaits` + 1, so it never runs the dami twice); anything else runs without one.
 * Nothing here is shown to the user: a missing bible only costs the project's extra rules.
 */
import { renderCreativeDna, type CreativeConsumer } from "../../src/server/damis";
import { enqueue, type JobDefinition, type JobInput } from "../../src/server/jobs";
import { logLine } from "../../src/server/jobs/log";
import { BIBLE_WAIT_RETRY_MS, bibleForRun } from "../../src/server/projects";

export type CreativeDnaForRun =
  /** The job was deferred: do nothing else (the delayed copy does the work). */
  { deferred: true } | { deferred: false; creativeDna: string | undefined };

type WaitingPayload = { bibleWaits?: number | undefined };

/**
 * Call after the handler decided the job is still wanted and before its first paid call.
 * `payload` is the job's own payload; the deferral re-enqueues it with the wait count raised.
 */
export async function creativeDnaForRun<J extends JobDefinition>(input: {
  projectId: string;
  consumer: CreativeConsumer;
  job: J;
  payload: JobInput<J> & WaitingPayload;
  now?: Date;
}): Promise<CreativeDnaForRun> {
  const now = input.now ?? new Date();
  const decision = await bibleForRun(input.projectId, { now });
  const fields = { job: input.job.name, projectId: input.projectId, consumer: input.consumer };
  switch (decision.kind) {
    case "ready":
      return {
        deferred: false,
        creativeDna: renderCreativeDna(input.consumer, decision.bible.bible).text,
      };
    case "wait": {
      const waits = (input.payload.bibleWaits ?? 0) + 1;
      await enqueue(input.job, { ...input.payload, bibleWaits: waits } as JobInput<J>, {
        startAfter: new Date(now.getTime() + BIBLE_WAIT_RETRY_MS),
      });
      logLine("info", "creative bible still compiling: job deferred", { ...fields, waits });
      return { deferred: true };
    }
    case "none":
      if (decision.reason !== "none" && decision.reason !== "superseded") {
        logLine("warn", "creative bible not used", { ...fields, reason: decision.reason });
      }
      return { deferred: false, creativeDna: undefined };
  }
}
