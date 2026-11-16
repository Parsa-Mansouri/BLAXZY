import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildProjectNamerPrompt } from "./prompt";
import {
  NAME_MAX_CHARS,
  projectNamerInputSchema,
  projectNamerOutputSchema,
  type ProjectNamerOutput,
} from "./schema";

export const PROJECT_NAMER_VERSION = "1.0.0";

const QUOTES = /["'“”‘’«»„‟`]/;
const GENERIC = /^(untitled(\s+project)?|film|movie|title)$/i;

/** The title rules the JSON schema cannot express. */
export function checkProjectName(output: ProjectNamerOutput): string[] {
  const title = output.title;
  const problems: string[] = [];
  if (title.trim().length === 0) problems.push("title must not be empty");
  if (title.trim() !== title) problems.push("title must have no leading or trailing spaces");
  if (title.length > NAME_MAX_CHARS) {
    problems.push(`title has ${title.length} characters: shorten it to at most ${NAME_MAX_CHARS}`);
  }
  if (/[\r\n]/.test(title)) problems.push("title must be one line");
  if (QUOTES.test(title.charAt(0)) || QUOTES.test(title.charAt(title.length - 1))) {
    problems.push("title must not be wrapped in quotation marks");
  }
  if (/[.。]$/.test(title)) problems.push("title must not end with a period");
  if (GENERIC.test(title.trim().replace(/[.!]+$/, ""))) {
    problems.push('title must be a real title, not "Untitled", "Film" or "Movie"');
  }
  return problems;
}

export const projectNamer = defineDami({
  key: "project-namer",
  version: PROJECT_NAMER_VERSION,
  description:
    "Names a project once, from the first story the user gives (brief, idea or uploaded script) and the project's genre, visual style and format: one short film title in the story's language.",
  input: projectNamerInputSchema,
  output: projectNamerOutputSchema,
  // A few words from a short text: the cheapest model, little reasoning.
  model: CLAUDE_MODELS.haiku,
  effort: "low",
  maxOutputTokens: 1024,
  build: buildProjectNamerPrompt,
  check: checkProjectName,
});
