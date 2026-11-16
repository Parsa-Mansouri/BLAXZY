/**
 * Sample project namer: a short Title Case title from the story's opening words (the first four
 * meaningful words of the first sentence, in story order). Deterministic, at most 60 characters,
 * in the story's own language and script.
 */
import {
  NAME_MAX_CHARS,
  projectNamerInputSchema,
  type ProjectNamerOutput,
} from "../project-namer/schema";
import { collapseWhitespace } from "./util";

const FILLER = new Set(
  "a an the and or but of to in on at by for with from into his her their its this that these those is are was were be been after before when while as it he she they we you who whom whose which what".split(
    " ",
  ),
);

/** Words that only introduce a name or a clause: a title never ends on them, so they are left out. */
const CONNECTORS = new Set(
  "named called known nicknamed titled who whose where there here have has had not no than then so if".split(
    " ",
  ),
);

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function sampleProjectNamer(input: unknown): ProjectNamerOutput {
  const { story } = projectNamerInputSchema.parse(input);
  const sentence = collapseWhitespace(story.split(/[.!?؟。\n]/).find((s) => s.trim()) ?? story);
  const words = sentence
    .split(" ")
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const meaningful = words.filter(
    (w) => w.length > 2 && !FILLER.has(w.toLowerCase()) && !CONNECTORS.has(w.toLowerCase()),
  );
  const picked = (meaningful.length >= 2 ? meaningful : words).slice(0, 4);
  let title = picked.map(capitalize).join(" ");
  if (title.length > NAME_MAX_CHARS) {
    const cut = title.slice(0, NAME_MAX_CHARS);
    title = cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd();
  }
  return { title: title || "Night Ferry" };
}
