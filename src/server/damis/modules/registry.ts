import type { ProjectStyle } from "@/server/db/schema";
import type { PromptText } from "../framework/define";
import { FORMAT_TEXT, ORIENTATION_TEXT } from "./formats";
import { comedy } from "./genres/comedy";
import { documentary } from "./genres/documentary";
import { drama } from "./genres/drama";
import { genericGenre } from "./genres/generic";
import { horror } from "./genres/horror";
import { sciFi } from "./genres/sci-fi";
import { thriller } from "./genres/thriller";
import { animation2d } from "./styles/animation-2d";
import { animation3d } from "./styles/animation-3d";
import { cinematicLiveAction } from "./styles/cinematic-live-action";
import { genericStyle } from "./styles/generic";
import type { DamiTask, PromptModule } from "./types";

/** Genre modules in registry order (the order also breaks ties when matching). */
export const GENRE_MODULES: readonly PromptModule[] = [
  drama,
  comedy,
  thriller,
  horror,
  sciFi,
  documentary,
];

/** Visual-style modules in registry order. */
export const STYLE_MODULES: readonly PromptModule[] = [
  cinematicLiveAction,
  animation3d,
  animation2d,
];

export const GENERIC_GENRE_MODULE = genericGenre;
export const GENERIC_STYLE_MODULE = genericStyle;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

function names(module: PromptModule): string[] {
  return [module.key, module.label, ...module.aliases].map(normalize).filter((n) => n.length > 0);
}

/**
 * Finds the module for a free-text value from the Style stage. Exact matches on key, label or
 * alias win. Otherwise the module whose name occurs earliest in the value wins ("psychological
 * thriller" -> thriller), ties broken by registry order. No match returns the fallback.
 * Names shorter than 3 characters only match exactly.
 */
function resolve(
  value: string,
  modules: readonly PromptModule[],
  fallback: PromptModule,
): PromptModule {
  const wanted = normalize(value);
  if (!wanted) return fallback;
  for (const m of modules) if (names(m).includes(wanted)) return m;
  let best: { module: PromptModule; position: number } | undefined;
  for (const m of modules) {
    for (const name of names(m)) {
      if (name.length < 3) continue;
      const position = wanted.indexOf(name);
      if (position >= 0 && (!best || position < best.position)) best = { module: m, position };
    }
  }
  return best?.module ?? fallback;
}

export function resolveGenreModule(genre: string): PromptModule {
  return resolve(genre, GENRE_MODULES, genericGenre);
}

export function resolveStyleModule(visualStyle: string): PromptModule {
  return resolve(visualStyle, STYLE_MODULES, genericStyle);
}

/** A module rendered for one task: its core text plus the task's guidance, if any. */
export function renderModule(module: PromptModule, task: DamiTask): string {
  const heading = module.kind === "genre" ? "Genre" : "Visual style";
  const parts = [`## ${heading}: ${module.label}`, module.core];
  const extra = module.tasks[task];
  if (extra) parts.push(extra);
  return parts.join("\n");
}

/**
 * The module part of a dami's system prompt, in fixed order: genre, visual style, format,
 * orientation. It is all stable text for a given (genre, style, format, orientation, task), and
 * the last block carries a cache breakpoint. Per-project values (durations, extras, the raw
 * genre label) belong in the user message, not here.
 */
export function composeModules(style: ProjectStyle, task: DamiTask): PromptText[] {
  const text = [
    renderModule(resolveGenreModule(style.genre), task),
    renderModule(resolveStyleModule(style.visualStyle), task),
    FORMAT_TEXT[style.format],
    ORIENTATION_TEXT[style.orientation],
  ].join("\n\n");
  return [{ text, cache: true }];
}
