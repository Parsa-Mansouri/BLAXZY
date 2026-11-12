/**
 * The Script Writer's structured screenplay as text. `renderScreenplay` writes the canonical
 * plain-text screenplay that `script_version.content` stores (the Script screen's parser, the
 * prompt-sectioner, review comments and the sheets all read text); `flattenForDetector` gives the
 * Asset Detector its `script.scenes[]`.
 */
import { z } from "zod";
import {
  screenplaySchema,
  type Screenplay,
  type ScreenplayElement,
  type ScreenplayScene,
} from "../script-writer/schema";

/** A series stitched into one screenplay: where each episode starts. */
export type EpisodeMarker = { number: number; title: string; firstScene: number };

/** What `script_version.screenplay` stores. */
export type StoredScreenplay = {
  screenplay: Screenplay;
  /** Series only: one marker per episode, in order. */
  episodes?: EpisodeMarker[];
};

const storedScreenplaySchema = z.object({
  screenplay: screenplaySchema,
  episodes: z
    .array(z.object({ number: z.number().int(), title: z.string(), firstScene: z.number().int() }))
    .optional(),
});

/** Reads `script_version.screenplay`: the stored screenplay, or null (none, or another shape). */
export function parseStoredScreenplay(value: unknown): StoredScreenplay | null {
  if (value === null || value === undefined) return null;
  const parsed = storedScreenplaySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type RenderedScene = {
  sceneNumber: number;
  heading: string;
  /** Offsets in the rendered text: `text.slice(start, end)` is the scene, heading included. */
  start: number;
  end: number;
};

export type RenderedScreenplay = { text: string; scenes: RenderedScene[] };

const INT_EXT_TEXT: Record<ScreenplayScene["heading"]["int_ext"], string> = {
  INT: "INT.",
  EXT: "EXT.",
  "INT/EXT": "INT./EXT.",
};

/** One line: no line breaks inside headings, cues and parentheticals. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `INT. LIGHTHOUSE GALLERY - NIGHT`. */
export function sceneHeadingText(scene: Pick<ScreenplayScene, "heading">): string {
  const h = scene.heading;
  return `${INT_EXT_TEXT[h.int_ext]} ${oneLine(h.location).toUpperCase()} - ${h.time_of_day}`;
}

function paragraph(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function cue(element: ScreenplayElement): string {
  const name = oneLine(element.character ?? "").toUpperCase();
  return element.extension ? `${name} (${element.extension})` : name;
}

function parenthetical(text: string): string {
  const inner = oneLine(text).replace(/^\(+|\)+$/g, "");
  return `(${inner})`;
}

/** A transition reads as one, never as a character cue: upper case, ending in ":" or ".". */
function transition(text: string): string {
  const t = oneLine(text).toUpperCase();
  return /[.:]$/.test(t) ? t : `${t}:`;
}

/** The lines of one element (no surrounding blank lines). */
function elementLines(element: ScreenplayElement): string[] {
  const text = paragraph(element.text ?? "");
  switch (element.type) {
    case "action":
      return text ? [text] : [];
    case "transition":
      return text ? [transition(text)] : [];
    case "dialogue": {
      const lines = [cue(element)];
      if (element.parenthetical?.trim()) lines.push(parenthetical(element.parenthetical));
      if (text) lines.push(text);
      return lines;
    }
  }
}

/** The scene's body (everything under its heading), blank-line separated. */
export function sceneBodyText(scene: ScreenplayScene): string {
  return scene.elements
    .map(elementLines)
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}

/**
 * The canonical screenplay text: for each scene its heading, a blank line and its elements
 * separated by blank lines; scenes separated by a blank line. A series gets an
 * `EPISODE n: TITLE` line before each episode's first scene. No title page (the title is shown
 * separately) and no scene numbers in the text (the owner's format forbids them).
 */
export function renderScreenplay(stored: StoredScreenplay): RenderedScreenplay {
  const episodeAt = new Map((stored.episodes ?? []).map((e) => [e.firstScene, e]));
  let text = "";
  const scenes: RenderedScene[] = [];
  const append = (chunk: string) => {
    if (text.length > 0) text += "\n\n";
    text += chunk;
  };
  for (const scene of stored.screenplay.scenes) {
    const episode = episodeAt.get(scene.scene_number);
    if (episode) {
      const title = oneLine(episode.title).toUpperCase();
      append(title ? `EPISODE ${episode.number}: ${title}` : `EPISODE ${episode.number}`);
    }
    const heading = sceneHeadingText(scene);
    const body = sceneBodyText(scene);
    append(heading);
    const start = text.length - heading.length;
    if (body) text += `\n\n${body}`;
    scenes.push({ sceneNumber: scene.scene_number, heading, start, end: text.length });
  }
  return { text: `${text}\n`, scenes };
}

/** The scene number holding a character offset of the rendered text (null before the first). */
export function sceneNumberAt(rendered: RenderedScreenplay, offset: number): number | null {
  let found: number | null = null;
  for (const scene of rendered.scenes) {
    if (scene.start <= offset) found = scene.sceneNumber;
    else break;
  }
  return found;
}

export type DetectorScene = {
  scene_number: string;
  /** `INT./EXT. LOCATION - TIME`. */
  heading: string;
  text: string;
  purpose: string;
  change: string;
};

/** The Asset Detector's `script.scenes[]`: one entry per scene, its body as the rendered text. */
export function flattenForDetector(stored: StoredScreenplay): DetectorScene[] {
  return stored.screenplay.scenes.map((scene) => ({
    scene_number: String(scene.scene_number),
    heading: sceneHeadingText(scene),
    text: sceneBodyText(scene),
    purpose: scene.purpose,
    change: scene.change,
  }));
}
