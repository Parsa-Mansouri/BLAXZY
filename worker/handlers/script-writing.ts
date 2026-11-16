/**
 * The Script Writer v0.2 pipeline pieces the script handlers share: generate with the owner's
 * auto-correction loop, stitch episodes and sequences, and turn a screenplay into stored notes.
 */
import {
  estimate,
  REVISE_RUN_SETTINGS,
  renderScreenplay,
  runDami,
  runtimeCorrectionNote,
  runtimeVerdict,
  scriptWriter,
  toleranceSeconds,
  writerMaxTokens,
  type EpisodeMarker,
  type Screenplay,
  type ScreenplayScene,
  type StoredScreenplay,
  type SubmitScreenplay,
  type WriterProject,
} from "../../src/server/damis";
import type { AddedAssumption, ScriptDamiNotes } from "../../src/server/script";

/** The owner: at most two automatic revise passes for runtime. */
export const MAX_RUNTIME_PASSES = 2;

export type RunContext = { userId: string; projectId: string; signal: AbortSignal };

export type WrittenScreenplay = {
  output: SubmitScreenplay;
  runId: string;
  /** Revise passes the runtime loop made. */
  passes: number;
};

/**
 * generate → estimate → up to two revise passes (too_long / too_short with the owner's note) →
 * the last draft, whatever its runtime (the caller adds a visible warning when it is still off).
 */
export async function generateFitted(
  project: WriterProject,
  story: string,
  run: RunContext,
  creativeDna?: string,
): Promise<WrittenScreenplay> {
  const target = project.targetDurationSeconds;
  const first = await runDami(
    scriptWriter,
    { mode: "generate", project, story, ...(creativeDna ? { creativeDna } : {}) },
    { ...run, maxOutputTokens: writerMaxTokens(target) },
  );
  let output = first.output;
  let runId = first.runId;
  let passes = 0;
  for (; passes < MAX_RUNTIME_PASSES; passes++) {
    const seconds = estimate(output.screenplay).seconds;
    const verdict = runtimeVerdict(seconds, target);
    if (verdict === "ok") break;
    const revised = await runDami(
      scriptWriter,
      {
        mode: "revise",
        project,
        ...(creativeDna ? { creativeDna } : {}),
        previousScreenplay: output.screenplay,
        feedback: {
          issueType: "technical",
          selectedReasons: [verdict],
          customNote: runtimeCorrectionNote(seconds, target),
        },
      },
      { ...run, ...REVISE_RUN_SETTINGS, maxOutputTokens: writerMaxTokens(target) },
    );
    output = revised.output;
    runId = revised.runId;
  }
  return { output, runId, passes };
}

export function runtimeNote(screenplay: Screenplay, targetSeconds: number) {
  const estimatedSeconds = estimate(screenplay).seconds;
  return {
    estimatedSeconds,
    targetSeconds,
    toleranceSeconds: toleranceSeconds(targetSeconds),
    verdict: runtimeVerdict(estimatedSeconds, targetSeconds),
  };
}

/** The user-facing warning for a runtime still outside the tolerance. */
export function runtimeWarning(note: ReturnType<typeof runtimeNote>): string | null {
  if (note.verdict === "ok") return null;
  const way = note.verdict === "too_long" ? "longer" : "shorter";
  return `Runtime: this script runs about ${note.estimatedSeconds} s, ${way} than the ${note.targetSeconds} s you asked for. Accept it as it is, or ask for it to be ${note.verdict === "too_long" ? "shorter" : "longer"}.`;
}

const VALIDATION_KEYS = [
  "premise_preserved",
  "every_scene_has_goal_and_change",
  "cause_and_effect_clear",
  "genre_effect_traceable",
  "style_effect_traceable",
  "genre_and_style_kept_separate",
  "all_action_visible_or_audible",
  "names_and_props_consistent",
  "elements_valid",
  "no_production_directives",
  "within_duration_budget",
] as const;

export function assumptionsOf(output: SubmitScreenplay, prefix = ""): AddedAssumption[] {
  return output.added_assumptions.map((a) => ({
    text: `${prefix}${a.text}`,
    reason: a.reason,
    sceneNumber: a.scene_number,
  }));
}

/** The notes a written screenplay stores: what the user sees and what the pipeline keeps. */
export function notesFor(input: {
  stored: StoredScreenplay;
  outputs: SubmitScreenplay[];
  targetSeconds: number;
  assumptions?: AddedAssumption[];
  extraWarnings?: string[];
}): ScriptDamiNotes {
  const { stored, outputs } = input;
  const runtime = runtimeNote(stored.screenplay, input.targetSeconds);
  const warning = runtimeWarning(runtime);
  const failed = new Set<string>();
  for (const o of outputs) {
    for (const key of VALIDATION_KEYS) if (!o.validation[key]) failed.add(key);
  }
  const changeLog = outputs.flatMap((o) => o.change_log ?? []);
  return {
    title: stored.screenplay.title,
    logline: stored.screenplay.logline,
    addedAssumptions: input.assumptions ?? outputs.flatMap((o) => assumptionsOf(o)),
    warnings: [
      ...new Set([
        ...outputs.flatMap((o) => o.warnings),
        ...(input.extraWarnings ?? []),
        ...(warning ? [warning] : []),
      ]),
    ],
    ...(changeLog.length > 0
      ? {
          changeLog: changeLog.map((c) => ({
            sceneNumber: c.scene_number,
            change: c.change,
            addresses: c.addresses,
          })),
        }
      : {}),
    validation: {
      failed: [...failed],
      notes: outputs
        .map((o) => o.validation.notes)
        .filter(Boolean)
        .join(" "),
    },
    runtime,
  };
}

/** Scenes renumbered 1, 2, 3 ... in order. */
function renumber(scenes: ScreenplayScene[]): ScreenplayScene[] {
  return scenes.map((s, i) => ({ ...s, scene_number: i + 1 }));
}

/** A series written one episode per call, stitched into one screenplay in order. */
export function stitchEpisodes(episodes: SubmitScreenplay[]): StoredScreenplay {
  const markers: EpisodeMarker[] = [];
  const scenes: ScreenplayScene[] = [];
  episodes.forEach((e, i) => {
    markers.push({ number: i + 1, title: e.screenplay.title, firstScene: scenes.length + 1 });
    scenes.push(...e.screenplay.scenes);
  });
  const first = episodes[0]?.screenplay;
  const numbered = renumber(scenes);
  return {
    screenplay: {
      title: first?.title ?? "",
      logline: first?.logline ?? "",
      language: first?.language ?? "en",
      estimated_duration_seconds: numbered.reduce((n, s) => n + s.estimated_seconds, 0),
      scenes: numbered,
    },
    episodes: markers,
  };
}

/**
 * The owner's stitch checks for a long piece: numbering, every canonical name appears as written,
 * nobody speaks before being introduced. Returns the stitched screenplay and the warnings.
 */
export function stitchSegments(input: {
  title: string;
  logline: string;
  language: string;
  scenes: ScreenplayScene[];
  canonicalCharacters: string[];
}): { stored: StoredScreenplay; warnings: string[] } {
  const warnings: string[] = [];
  const expected = input.scenes.map((_, i) => i + 1).join(",");
  if (input.scenes.map((s) => s.scene_number).join(",") !== expected) {
    warnings.push("Scene numbers were renumbered while the sequences were joined.");
  }
  const scenes = renumber(input.scenes);
  const text = renderScreenplay({
    screenplay: {
      title: input.title,
      logline: input.logline,
      language: input.language,
      estimated_duration_seconds: 0,
      scenes,
    },
  }).text;
  for (const name of input.canonicalCharacters) {
    if (!text.toLocaleLowerCase().includes(name.toLocaleLowerCase())) {
      warnings.push(`The name "${name}" from the outline does not appear in the script.`);
    }
  }
  const seen = new Set<string>();
  for (const scene of scenes) {
    for (const el of scene.elements) {
      if (el.type === "action") {
        for (const word of (el.text ?? "").toLocaleLowerCase().split(/[^\p{L}\p{N}'’-]+/u)) {
          if (word) seen.add(word);
        }
      } else if (el.type === "dialogue" && el.character) {
        const first = el.character.toLocaleLowerCase().split(/\s+/)[0] ?? "";
        if (first && !seen.has(first) && el.extension !== "V.O.") {
          warnings.push(
            `${el.character} speaks in scene ${scene.scene_number} before being introduced.`,
          );
          seen.add(first);
        }
      }
    }
  }
  return {
    stored: {
      screenplay: {
        title: input.title,
        logline: input.logline,
        language: input.language,
        estimated_duration_seconds: scenes.reduce((n, s) => n + s.estimated_seconds, 0),
        scenes,
      },
    },
    warnings,
  };
}
