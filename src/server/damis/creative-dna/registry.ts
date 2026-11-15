/**
 * The owner's Creative Modules registry (Blackeiz Creative Intelligence): the shared core and the
 * 13 genre and visual-style modules, read from `source/creative_modules_registry.v1.json`.
 * Server-side only: the JSON is large, so never import this from `src/ui` or a client component.
 */
import { z } from "zod";
import { GENRES, LEGACY_GENRE_KEYS, LEGACY_STYLE_KEYS, VISUAL_STYLES } from "@/lib/style-options";
import type { ProjectStyle } from "@/server/db/schema";
import registryJson from "./source/creative_modules_registry.v1.json";

/**
 * A module as the owner wrote it. Only the fields the code reads are checked; the rest of the
 * module (the Persian fields and the example) is kept as it is, because the prompt sends the whole
 * module as JSON.
 */
export const creativeModuleSchema = z.looseObject({
  id: z.string().regex(/^(genre|style)\.[a-z0-9_]+$/),
  kind: z.enum(["genre", "style"]),
  name_en: z.string().min(1),
  version: z.string().min(1),
  specialization_en: z.string().min(1),
  must_nots_fa: z.array(z.string().min(1)).min(1),
  qc_criteria_fa: z.array(z.string().min(1)).length(6),
  boundary_tests_fa: z.array(z.string().min(1)),
});
export type CreativeModule = z.output<typeof creativeModuleSchema>;

const registrySchema = z.object({
  library: z.string().min(1),
  version: z.string().min(1),
  date: z.string().min(1),
  shared_core_en: z.string().min(1),
  system_guide_fa: z.unknown(),
  modules: z.array(creativeModuleSchema).min(1),
});

/** The registry, validated once when this module loads. */
export const CREATIVE_REGISTRY = registrySchema.parse(registryJson);

const MODULES_BY_ID: ReadonlyMap<string, CreativeModule> = new Map(
  CREATIVE_REGISTRY.modules.map((m) => [m.id, m]),
);

/** The module with this id (`genre.drama`, `style.noir`, ...), or undefined. */
export function findCreativeModule(id: string): CreativeModule | undefined {
  return MODULES_BY_ID.get(id);
}

/** The module with this id; throws for an unknown id. */
export function getCreativeModule(id: string): CreativeModule {
  const found = MODULES_BY_ID.get(id);
  if (!found) throw new Error(`Unknown creative module id: ${id}`);
  return found;
}

/**
 * Style-screen keys (`GENRES`, `VISUAL_STYLES` in `@/lib/style-options`) to registry ids. Written
 * out, not derived, so a new tile fails the test until it is mapped.
 */
const GENRE_MODULE_IDS: Readonly<Record<string, string>> = {
  drama: "genre.drama",
  comedy: "genre.comedy",
  horror: "genre.horror",
  thriller: "genre.thriller",
  action: "genre.action",
  "sci-fi": "genre.sci_fi",
};
const STYLE_MODULE_IDS: Readonly<Record<string, string>> = {
  realistic: "style.realistic",
  noir: "style.noir",
  futuristic: "style.futuristic",
  "horror-visual": "style.horror_visual",
  "3d-animation": "style.animation_3d",
  anime: "style.anime",
  claymation: "style.claymation",
};

/** Every Style-screen key that has a module (for tests and checks). */
export const MAPPED_GENRE_KEYS: readonly string[] = GENRES.map((o) => o.value);
export const MAPPED_STYLE_KEYS: readonly string[] = VISUAL_STYLES.map((o) => o.value);

export type CreativeModuleIds = { genreId: string; styleId: string };

/**
 * The registry modules for a project's Style answers, or null when the genre or the visual style
 * is a typed "Other" (free text): such projects get no Creative Bible. Legacy keys older projects
 * stored are mapped to today's options first.
 */
export function registryIdsForStyle(
  style: Pick<ProjectStyle, "genre" | "visualStyle">,
): CreativeModuleIds | null {
  const genreKey = LEGACY_GENRE_KEYS[style.genre] ?? style.genre;
  const styleKey = LEGACY_STYLE_KEYS[style.visualStyle] ?? style.visualStyle;
  const genreId = Object.hasOwn(GENRE_MODULE_IDS, genreKey) ? GENRE_MODULE_IDS[genreKey] : null;
  const styleId = Object.hasOwn(STYLE_MODULE_IDS, styleKey) ? STYLE_MODULE_IDS[styleKey] : null;
  if (!genreId || !styleId) return null;
  return { genreId, styleId };
}
