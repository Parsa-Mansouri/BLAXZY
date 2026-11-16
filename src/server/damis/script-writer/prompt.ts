/**
 * Assembles the Script Writer v0.2 request exactly as the owner's section 0 says:
 * system = CORE + the chosen GENRE MODULE + the chosen STYLE MODULE; user = the section 4
 * template with its placeholders filled. Format, orientation and model details are never sent
 * (the owner forbids it: they belong to shot design).
 *
 * Cache layout (src/server/damis/README.md): the core is one cached block; the module slots are a
 * second cached block; the user message holds the per-request content.
 */
import type { z } from "zod";
import type { DamiPrompt, PromptText } from "../framework/define";
import { withCreativeDna } from "../shared/creative-dna-input";
import { SCRIPT_WRITER_CORE, SCRIPT_WRITER_GENRES, SCRIPT_WRITER_STYLES } from "./modules";
import type {
  scriptOutlineInputSchema,
  scriptWriterInputSchema,
  writerProjectSchema,
} from "./schema";

type WriterInput = z.output<typeof scriptWriterInputSchema>;
type OutlineInput = z.output<typeof scriptOutlineInputSchema>;
type Project = z.output<typeof writerProjectSchema>;

/*
 * Fallbacks for a genre or style the user typed themselves ("Other"). These are ours, not the
 * owner's: they keep the module slot filled in the owner's module format with the user's words.
 */
function customGenreModule(name: string): string {
  return [
    `GENRE: ${name}`,
    "Definition: the genre the user named, in their words.",
    "Apply to the script:",
    "- Shape conflict, rhythm, dialogue and how scenes resolve the way this genre is commonly understood.",
    "Avoid: changing the user's events, characters or ending to fit the genre.",
  ].join("\n");
}

function customStyleModule(name: string): string {
  return [
    `VISUAL STYLE: ${name}`,
    "Identity: the visual style the user described, in their words.",
    "Apply to the script:",
    "- Let it shape only visible detail and how the physical world behaves.",
    "Avoid: camera, lens, render or model language.",
  ].join("\n");
}

export function genreModule(ownerGenre: string): string {
  return SCRIPT_WRITER_GENRES[ownerGenre] ?? customGenreModule(ownerGenre);
}

export function styleModule(ownerStyle: string): string {
  return SCRIPT_WRITER_STYLES[ownerStyle] ?? customStyleModule(ownerStyle);
}

/** The core's module slots, filled (the owner's `{{GENRE_MODULE}}` / `{{STYLE_MODULE}}`). */
export function moduleSlots(project: Pick<Project, "genre" | "visualStyle">): string {
  return [
    "<genre_module>",
    genreModule(project.genre),
    "</genre_module>",
    "",
    "<style_module>",
    styleModule(project.visualStyle),
    "</style_module>",
  ].join("\n");
}

function systemPrompt(project: Project, creativeDna: string | undefined): PromptText[] {
  return withCreativeDna(
    [
      { text: SCRIPT_WRITER_CORE, cache: true },
      { text: moduleSlots(project), cache: true },
    ],
    creativeDna,
  );
}

const opt = (value: string | undefined) => value ?? "";

/** The `<project>` block. `creative_expansion` defaults to false (Wizard). */
export function renderProject(project: Project): string {
  const range = project.budget.sceneCountRange;
  return [
    "<project>",
    `  <format>${project.format}</format>`,
    `  <target_duration_seconds>${project.targetDurationSeconds}</target_duration_seconds>`,
    "  <duration_budget>",
    `    <scene_count_range>${range ? `${range.min}-${range.max}` : "set by outline"}</scene_count_range>`,
    `    <dialogue_word_budget>${project.budget.dialogueWordBudget}</dialogue_word_budget>`,
    `    <action_beat_budget>${project.budget.actionBeatBudget}</action_beat_budget>`,
    `    <tolerance_seconds>${project.budget.toleranceSeconds}</tolerance_seconds>`,
    "  </duration_budget>",
    `  <output_language>${opt(project.outputLanguage)}</output_language>`,
    `  <audience_rating>${opt(project.audienceRating)}</audience_rating>`,
    `  <creative_expansion>${project.creativeExpansion ? "true" : "false"}</creative_expansion>`,
    `  <project_notes>${opt(project.projectNotes)}</project_notes>`,
    "</project>",
  ].join("\n");
}

/** The user message for generate, revise and write_segment (section 4). */
export function renderWriterMessage(input: WriterInput): string {
  const project = renderProject(input.project);
  switch (input.mode) {
    case "generate":
      // The story goes in unmodified, never summarized.
      return ["<mode>generate</mode>", project, "<story>", input.story, "</story>"].join("\n");
    case "revise": {
      const f = input.feedback;
      return [
        "<mode>revise</mode>",
        project,
        "<previous_screenplay>",
        JSON.stringify(input.previousScreenplay, null, 2),
        "</previous_screenplay>",
        "<feedback>",
        `  <issue_type>${f.issueType}</issue_type>`,
        `  <selected_reasons>${f.selectedReasons.join(", ")}</selected_reasons>`,
        `  <custom_note>${opt(f.customNote)}</custom_note>`,
        `  <scope>${(f.scope ?? []).join(", ")}</scope>`,
        "</feedback>",
      ].join("\n");
    }
    case "write_segment":
      return [
        "<mode>write_segment</mode>",
        project,
        "<approved_outline>",
        JSON.stringify(input.approvedOutline, null, 2),
        "</approved_outline>",
        `<segment_id>${input.segmentId}</segment_id>`,
        "<continuity_ledger>",
        input.continuityLedger ? JSON.stringify(input.continuityLedger, null, 2) : "",
        "</continuity_ledger>",
        "<previous_tail>",
        input.previousTail ? JSON.stringify(input.previousTail, null, 2) : "",
        "</previous_tail>",
      ].join("\n");
  }
}

/** The user message for outline mode. */
export function renderOutlineMessage(input: OutlineInput): string {
  return [
    "<mode>outline</mode>",
    renderProject(input.project),
    `<story>${input.story}</story>`,
    `<feedback>${opt(input.feedback)}</feedback>`,
  ].join("\n");
}

export function buildScriptWriterPrompt(input: WriterInput): DamiPrompt {
  return {
    system: systemPrompt(input.project, input.creativeDna),
    messages: [{ role: "user", content: [{ text: renderWriterMessage(input) }] }],
  };
}

export function buildScriptOutlinePrompt(input: OutlineInput): DamiPrompt {
  return {
    system: systemPrompt(input.project, input.creativeDna),
    messages: [{ role: "user", content: [{ text: renderOutlineMessage(input) }] }],
  };
}
