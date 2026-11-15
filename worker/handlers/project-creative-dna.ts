import { creativeDna, runDami } from "../../src/server/damis";
import { defineHandler, projectCreativeDna } from "../../src/server/jobs";
import {
  completeCreativeBible,
  failCreativeBible,
  loadCreativeBibleJob,
} from "../../src/server/projects";
import { classifyCreativeFailure } from "./creative-failure";
import { handleFailure } from "./failure";

/** Compiles a project's Creative Bible from its saved Style: creative-dna → ready. */
export const projectCreativeDnaHandler = defineHandler(
  projectCreativeDna,
  async (payload, context) => {
    const bibleId = payload.bibleId;
    const job = await loadCreativeBibleJob(bibleId);
    // Idempotent: only a row still waiting is worked on. A Style change supersedes it.
    if (!job || job.row.status !== "pending") return;
    try {
      if (!job.input) {
        await failCreativeBible({
          bibleId,
          failure: "This genre or visual style has no creative rules.",
          damiRunId: null,
        });
        return;
      }
      const run = await runDami(creativeDna, job.input, {
        userId: job.project.ownerId,
        projectId: job.project.id,
        signal: context.signal,
      });
      if (run.output.validation_status === "rejected") {
        await failCreativeBible({
          bibleId,
          failure: "The creative rules could not be prepared for this genre and style.",
          damiRunId: run.runId,
        });
        return;
      }
      await completeCreativeBible({ bibleId, bible: run.output, damiRunId: run.runId });
    } catch (error) {
      await handleFailure(
        error,
        projectCreativeDna,
        context,
        async (d) => {
          await failCreativeBible({ bibleId, failure: d.message, damiRunId: d.runId });
        },
        classifyCreativeFailure,
      );
    }
  },
);
