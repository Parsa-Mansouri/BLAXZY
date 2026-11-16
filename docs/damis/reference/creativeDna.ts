// BLAXZY · DAMI-00 CREATIVE_DNA — server-side only (Next.js route handler / server action)
// deps: npm i @anthropic-ai/sdk ajv
import Anthropic from "@anthropic-ai/sdk";
import Ajv2020 from "ajv/dist/2020";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "damis", "creative_dna");
const SYSTEM_PROMPT = fs.readFileSync(path.join(DIR, "dami_00_creative_dna.system.md"), "utf8");
const REGISTRY = JSON.parse(fs.readFileSync(path.join(DIR, "creative_modules_registry.v1.json"), "utf8"));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(DIR, "output_10.schema.json"), "utf8"));

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);
const client = new Anthropic(); // ANTHROPIC_API_KEY from env

export const MODEL = process.env.DAMI_CREATIVE_DNA_MODEL ?? "claude-opus-5-5";

export type ProjectSettings = {
  genre_id: string; style_id: string;
  format: "film" | "series"; episode_count?: number | null;
  episode_duration_sec?: number | null; total_duration_sec?: number | null;
  orientation: "portrait" | "landscape" | "square";
  audience?: string | null; script_language: string; ui_language: string;
  dialogue_policy?: "normal" | "minimal" | "none" | null;
  brief?: string; references?: string[]; locks?: string[];
};

export const PLATFORM_CONFIG = {
  block_length_options_sec: [15, 30],
  default_block_length_sec: 15,
  speech_rate_wps: { en: 2.5, fa: 2.0, tr: 2.0, default: 2.2 }, // tune from real TTS timing
  max_events_per_block: { "15": 2, "30": 4 },
};

function getModule(id: string) {
  const m = REGISTRY.modules.find((x: any) => x.id === id);
  if (!m) throw new Error(`Unknown module id: ${id}`);
  return m;
}

function buildUserTurn(s: ProjectSettings) {
  const genre = getModule(s.genre_id);
  const style = getModule(s.style_id);
  const { genre_id, style_id, ...settings } = s;
  return [
    `<shared_core>\n${REGISTRY.shared_core_en}\n</shared_core>`,
    `<genre_module>\n${JSON.stringify(genre)}\n</genre_module>`,
    `<style_module>\n${JSON.stringify(style)}\n</style_module>`,
    `<project_settings>\n${JSON.stringify(settings)}\n</project_settings>`,
    `<platform_config>\n${JSON.stringify(PLATFORM_CONFIG)}\n</platform_config>`,
    `Compile output_10 now. Return only the JSON object.`,
  ].join("\n\n");
}

function parseJson(text: string) {
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(clean);
}

/** Compile the Creative Bible (output_10). One automatic repair attempt on invalid output. */
export async function compileCreativeDNA(settings: ProjectSettings) {
  // cheap guard before spending tokens (the prompt also rejects this; see test t10)
  if (getModule(settings.genre_id).kind !== "genre" || getModule(settings.style_id).kind !== "style")
    throw new Error("CREATIVE_DNA: genre_id must be a genre module and style_id a style module");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserTurn(settings) }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // static system prompt is identical for every project -> cache it
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
    });
    const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");

    let out: any; let error = "";
    try {
      out = parseJson(text);
      if (out.validation_status === "rejected") return out; // minimal skeleton allowed
      if (!validate(out)) error = JSON.stringify(validate.errors?.slice(0, 15));
      else error = semanticCheck(out, settings);
    } catch (e: any) { error = `Invalid JSON: ${e.message}`; }

    if (!error) return out;
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content:
      `Your output failed validation:\n${error}\nReturn the full corrected JSON object only.` });
  }
  throw new Error("CREATIVE_DNA: output failed validation twice");
}

/** Checks the schema cannot express. Returns "" when OK. */
function semanticCheck(out: any, s: ProjectSettings): string {
  const errs: string[] = [];
  if (out.selection.genre_id !== s.genre_id || out.selection.style_id !== s.style_id)
    errs.push("selection ids do not match the requested genre_id/style_id");
  const qc = out.qc_checklist.filter((q: any) => q.type === "criterion");
  if (qc.filter((q: any) => q.source === "genre").length < 6) errs.push("qc_checklist needs all 6 genre criteria");
  if (qc.filter((q: any) => q.source === "style").length < 6) errs.push("qc_checklist needs all 6 style criteria");
  const ids = new Set<string>();
  const walk = (arr: any[]) => arr?.forEach((x) => { if (ids.has(x.id)) errs.push(`duplicate id ${x.id}`); ids.add(x.id); });
  Object.values(out.slices).forEach((sl: any) => { walk(sl.rules); walk(sl.series_rules ?? []); });
  Object.values(out.review_options).forEach((p: any) => { walk(p.technical); walk(p.preference); });
  if (s.dialogue_policy === "none" && out.project_frame.max_spoken_words_per_block !== 0)
    errs.push("dialogue_policy none requires max_spoken_words_per_block = 0");
  return errs.join("\n");
}

/* ------------------------------------------------------------------------------------------
 * Consumers: every downstream dami calls this to get its genre/style context block.
 * Static part (shared core + 2 specializations) + project slice from output_10.
 * Put the returned string in that dami's system prompt (after its own instructions),
 * and mark it with cache_control so repeated calls in the same project are cheap.
 * ---------------------------------------------------------------------------------------- */
type Consumer =
  | "script_writer" | "script_checker" | "asset_detector" | "asset_generation"
  | "sheet_generator" | "director" | "text_blocks_video";

const QC_STAGE: Record<Consumer, string[]> = {
  script_writer: ["script", "all"], script_checker: ["script", "all"],
  asset_detector: ["asset", "all"], asset_generation: ["asset", "all"],
  sheet_generator: ["sheet", "all"], director: ["text_block", "video", "all"],
  text_blocks_video: ["text_block", "video", "all"],
};

export function buildConsumerContext(consumer: Consumer, bible: any): string {
  const genre = getModule(bible.selection.genre_id);
  const style = getModule(bible.selection.style_id);
  const slice = bible.slices[`for_${consumer}`];
  const rules = [...slice.rules, ...(slice.series_rules ?? [])].map((r: any) => `- ${r.rule}`).join("\n");
  const qc = bible.qc_checklist
    .filter((q: any) => QC_STAGE[consumer].includes(q.stage))
    .map((q: any) => `- ${q.criterion}`).join("\n");
  const extras = Object.entries(slice).filter(([k]) => !["rules", "series_rules"].includes(k))
    .map(([k, v]) => `<${k}>\n${JSON.stringify(v)}\n</${k}>`).join("\n");

  return `<creative_dna version="${bible.dami_version}" genre="${genre.id}" style="${style.id}">
<shared_core>\n${REGISTRY.shared_core_en}\n</shared_core>
<genre_specialization>\n${genre.specialization_en}\n</genre_specialization>
<style_specialization>\n${style.specialization_en}\n</style_specialization>
<contracts>\nGenre: ${bible.contracts.genre_contract}\nStyle: ${bible.contracts.style_contract}\nCombination: ${bible.contracts.combination_logic}\n</contracts>
<project_frame>\n${JSON.stringify(bible.project_frame)}\n</project_frame>
<project_rules>\n${rules}\n</project_rules>
${extras}
<never_add>\n${bible.anti_cliche_guards.map((g: any) => `- ${g.guard}`).join("\n")}\n</never_add>
<continuity_locks>\n${bible.continuity_locks.map((l: string) => `- ${l}`).join("\n")}\n</continuity_locks>
<self_check_before_output>\n${qc}\n</self_check_before_output>
</creative_dna>`;
}

/** Wizard reject flow: options for a review screen ("technical" | "preference"). */
export function getReviewOptions(bible: any, point: "script" | "asset" | "sheet" | "text_block" | "video") {
  return bible.review_options[point];
}
