/**
 * Script Writer v0.2 (the owner's `script_writer`). Two damis share one system prompt:
 * - `script-writer` answers with `submit_screenplay` (modes generate, revise, write_segment);
 * - `script-writer-outline` answers with `submit_outline` (outline mode, long pieces).
 *
 * Settings (docs/damis/README.md): the owner's forced tool call is our structured JSON output; his
 * temperatures become effort (0.7 drafting → medium, 0.3 revision → low: the worker passes
 * `effort: "low"` and the Sonnet model for revise runs, as the owner recommends). Runtime is not
 * checked here: the worker estimates it with `shared/duration.ts` and runs revise passes.
 */
import type { z } from "zod";
import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildScriptOutlinePrompt, buildScriptWriterPrompt } from "./prompt";
import {
  scriptOutlineInputSchema,
  scriptWriterInputSchema,
  submitOutlineSchema,
  submitScreenplaySchema,
  type SubmitOutline,
  type SubmitScreenplay,
} from "./schema";

type WriterInput = z.output<typeof scriptWriterInputSchema>;

/** Settings the worker passes for revise runs (the owner: Sonnet-class, temperature 0.3). */
export const REVISE_RUN_SETTINGS = { model: CLAUDE_MODELS.sonnet, effort: "low" } as const;

/** The owner's max_tokens: 8000 up to 5 minutes, about 16000 up to 15; outline and segments more. */
export function writerMaxTokens(targetSeconds: number): number {
  if (targetSeconds <= 300) return 8_000;
  if (targetSeconds <= 900) return 16_000;
  return 32_000;
}

function checkElements(output: SubmitScreenplay): string[] {
  const issues: string[] = [];
  output.screenplay.scenes.forEach((scene, i) => {
    scene.elements.forEach((el, j) => {
      const at = `screenplay.scenes.${i}.elements.${j}`;
      if (!el.text?.trim()) issues.push(`${at}: a ${el.type} element needs text`);
      if (el.type === "dialogue" && !el.character?.trim()) {
        issues.push(`${at}: a dialogue element needs the speaker's canonical name in character`);
      }
      if (el.type !== "dialogue" && (el.character || el.parenthetical || el.extension)) {
        issues.push(`${at}: only dialogue elements carry character, extension or parenthetical`);
      }
    });
  });
  return issues;
}

function checkNumbering(output: SubmitScreenplay, expected: number[] | null): string[] {
  const numbers = output.screenplay.scenes.map((s) => s.scene_number);
  if (expected) {
    if (numbers.join(",") !== expected.join(",")) {
      return [
        `screenplay.scenes: write exactly the outline's scenes ${expected.join(", ")} in order (got ${numbers.join(", ")})`,
      ];
    }
    return [];
  }
  for (let i = 1; i < numbers.length; i++) {
    if ((numbers[i] ?? 0) <= (numbers[i - 1] ?? 0)) {
      return ["screenplay.scenes: scene numbers must increase in script order"];
    }
  }
  return [];
}

export function checkScreenplay(output: SubmitScreenplay, input: WriterInput): string[] {
  const issues = [...checkElements(output)];
  const sum = output.screenplay.scenes.reduce((n, s) => n + s.estimated_seconds, 0);
  if (sum !== output.screenplay.estimated_duration_seconds) {
    issues.push(
      `screenplay.estimated_duration_seconds is ${output.screenplay.estimated_duration_seconds} but the scenes' estimated_seconds add up to ${sum}; make them agree`,
    );
  }
  let expected: number[] | null = null;
  if (input.mode === "write_segment") {
    const sequence = input.approvedOutline.acts
      .flatMap((a) => a.sequences)
      .find((s) => s.id === input.segmentId);
    expected = sequence ? sequence.scenes.map((s) => s.scene_number) : null;
    if (output.segment_id !== input.segmentId) {
      issues.push(`segment_id must be "${input.segmentId}"`);
    }
    if (!output.continuity_ledger) {
      issues.push("continuity_ledger is required in write_segment mode: return the updated ledger");
    }
  }
  if (input.mode === "generate" && output.screenplay.scenes[0]?.scene_number !== 1) {
    issues.push("screenplay.scenes: number the scenes from 1");
  }
  if (input.mode === "revise" && (output.change_log ?? []).length === 0) {
    issues.push("change_log is required in revise mode: one entry per change");
  }
  issues.push(...checkNumbering(output, expected));
  return issues;
}

export function checkOutline(
  output: SubmitOutline,
  input: z.output<typeof scriptOutlineInputSchema>,
): string[] {
  const issues: string[] = [];
  let actSum = 0;
  let next = 1;
  const ids = new Set<string>();
  output.acts.forEach((act, a) => {
    actSum += act.target_seconds;
    let seqSum = 0;
    act.sequences.forEach((seq, s) => {
      if (ids.has(seq.id)) issues.push(`acts.${a}.sequences.${s}: sequence id "${seq.id}" repeats`);
      ids.add(seq.id);
      seqSum += seq.target_seconds;
      const sceneSum = seq.scenes.reduce((n, sc) => n + sc.target_seconds, 0);
      if (sceneSum !== seq.target_seconds) {
        issues.push(
          `acts.${a}.sequences.${s}: scene targets add up to ${sceneSum}, not the sequence target ${seq.target_seconds}`,
        );
      }
      for (const scene of seq.scenes) {
        if (scene.scene_number !== next) {
          issues.push(
            `acts.${a}.sequences.${s}: scene ${scene.scene_number} should be number ${next} (number scenes 1, 2, 3 ... across the whole outline)`,
          );
        }
        next = scene.scene_number + 1;
      }
    });
    if (seqSum !== act.target_seconds) {
      issues.push(
        `acts.${a}: sequence targets add up to ${seqSum}, not the act target ${act.target_seconds}`,
      );
    }
  });
  const target = input.project.targetDurationSeconds;
  if (actSum !== target) {
    issues.push(`act targets add up to ${actSum}, not target_duration_seconds ${target}`);
  }
  if (output.canonical_names.characters.length === 0) {
    issues.push("canonical_names.characters is empty: lock every character's name");
  }
  return issues;
}

export const scriptWriter = defineDami({
  key: "script-writer",
  version: "0.3.0",
  description:
    "Turns a story, genre and visual style into a structured screenplay sized to an exact runtime; also revises one and writes the sequences of a long piece.",
  input: scriptWriterInputSchema,
  output: submitScreenplaySchema,
  // The owner: the strongest model for drafting (Opus 5.5); revise runs pass Sonnet.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  // Overridden per call with `writerMaxTokens(target)`; long outputs stream.
  maxOutputTokens: 16_000,
  streaming: true,
  build: buildScriptWriterPrompt,
  check: checkScreenplay,
});

export const scriptOutliner = defineDami({
  key: "script-writer-outline",
  version: "0.3.0",
  description:
    "Plans a long piece (over 15 minutes) as acts, sequences and scenes with locked names, for the user to approve before any scene is written.",
  input: scriptOutlineInputSchema,
  output: submitOutlineSchema,
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: 32_000,
  build: buildScriptOutlinePrompt,
  check: checkOutline,
});
