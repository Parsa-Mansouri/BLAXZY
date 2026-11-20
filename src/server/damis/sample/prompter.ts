/**
 * Sample PROMPTER v1.0: one prompt per unit in the owner's block or shot layout, built from the
 * input with no Claude call, padded with ambience to the word range, so it passes `check()`.
 */
import { countWords, FORBIDDEN_PROMPT_WORDS } from "../director/validate";
import { costumeDescriptorFor } from "../director-v2/schema";
import type { BreakdownUnit } from "../breakdown/schema";
import { promptWordRange } from "../shared/pipeline-platform";
import {
  prompterInputSchema,
  type PrompterInput,
  type PrompterOutput,
  type PrompterUnit,
} from "../prompter/schema";
import { unitMaterial, type UnitMaterial } from "../prompter/validate";
import { collapseWhitespace } from "./util";

const scrub = (text: string) => collapseWhitespace(text.replace(FORBIDDEN_PROMPT_WORDS, ""));
const words = (id: string) => id.replace(/^(genre|style)\./, "").replace(/[_.]/g, " ");
const SIZE: Readonly<Record<string, string>> = {
  extreme_wide: "Extreme wide shot",
  wide: "Wide shot",
  full: "Full shot",
  medium: "Medium shot",
  medium_close: "Medium close-up",
  close: "Close-up",
  extreme_close: "Extreme close-up",
  ots: "Over-the-shoulder shot",
  pov: "Point-of-view shot",
  insert: "Insert shot",
};
const PADDING = [
  "Quiet room tone under everything.",
  "Soft breathing close to the microphone.",
  "Fabric rustles with each small movement.",
  "A faint street murmur far outside.",
  "Footsteps settle on the floor.",
  "A clock ticks somewhere in the room.",
];

function nameOf(input: PrompterInput, id: string): string {
  const bible = input.director.continuity_bible.characters.find((c) => c.asset_id === id);
  return (bible?.name ?? id).toUpperCase();
}

function writeUnit(unit: BreakdownUnit, m: UnitMaterial, input: PrompterInput): PrompterUnit {
  const bible = input.director.continuity_bible;
  const look = input.cinematographer.look_bible;
  const project = input.director.project;
  const sel = input.creative_bible.selection;
  const firstShot = unit.shots[0]?.shot_id ?? "";
  const staging = input.director.staging_states.find((s) => s.staging_id === unit.start_staging_id);
  const lines: string[] = ["BEGIN PROMPT"];
  let shotLines: (compact: boolean) => string[] = () => [];
  const kind = project.format === "series" ? "series episode" : "film";
  lines.push(
    unit.unit_type === "block"
      ? `A ${unit.duration_s}-second sequence from a ${words(sel.style_id)} ${words(sel.genre_id)} ${kind}, ${project.aspect_ratio}.`
      : `A ${unit.generate_s}-second single shot from a ${words(sel.style_id)} ${words(sel.genre_id)} ${kind}, ${project.aspect_ratio}.`,
  );
  const shotLine = (i: number, compact: boolean) => {
    const d = m.directorShots[i];
    const c = m.dpShots[i];
    if (!d || !c) return "";
    const dialogue = d.dialogue
      .map((x) =>
        x.heard_as === "on_screen"
          ? `${nameOf(input, x.speaker_id)}, ${x.delivery}: "${x.line}"`
          : `${nameOf(input, x.speaker_id)}'s voice, off screen: "${x.line}"`,
      )
      .join(" ");
    return [
      compact
        ? `${SIZE[d.size] ?? "Medium shot"}, ${scrub(d.angle)}, ${c.phrases.lens_phrase}.`
        : `${SIZE[d.size] ?? "Medium shot"}, ${scrub(d.angle)}, ${scrub(d.camera_height)}, ${scrub(d.axis_offset)}, ${c.phrases.lens_phrase}.`,
      c.phrases.camera_phrase,
      compact ? "" : c.phrases.composition_phrase,
      `${scrub(d.action)}`,
      dialogue,
      c.phrases.light_accent,
    ]
      .filter((x) => x.trim() !== "")
      .join(" ");
  };
  const assetLines = [
    `Characters: ${m.characters
      .map(
        (id) =>
          `@${id} ${nameOf(input, id)} — ${costumeDescriptorFor(bible, id, firstShot, input.director.shots) ?? ""}.`,
      )
      .join(" ")}`,
    `Locations: ${m.locations.map((id) => `@${id} — ${bible.locations.find((l) => l.asset_id === id)?.descriptor ?? ""}.`).join(" ")}`,
    ...(m.props.length > 0
      ? [
          `Props: ${m.props.map((id) => `@${id} — ${bible.props.find((p) => p.asset_id === id)?.descriptor ?? ""}.`).join(" ")}`,
        ]
      : []),
  ];
  const stagingLine = `Staging: ${(staging?.entries ?? [])
    .map(
      (e) =>
        `${nameOf(input, e.character_id)} ${scrub(e.position)}, ${e.posture}, ${e.facing}, ${e.screen_side}.`,
    )
    .join(" ")} ${scrub(staging?.meaning ?? "")}`;
  const opening = `Opening frame: ${scrub(unit.opening_frame)}`;
  if (unit.unit_type === "shot") {
    const d = m.directorShots[0];
    const c = m.dpShots[0];
    lines.push(
      `Shot: ${SIZE[d?.size ?? ""] ?? "Medium shot"}, ${scrub(d?.angle ?? "")}, ${c?.phrases.lens_phrase ?? ""}. ${c?.phrases.camera_phrase ?? ""} ${c?.phrases.composition_phrase ?? ""}`,
    );
    lines.push(...assetLines, stagingLine, opening, "Action:");
    const half = Math.max(1, Math.floor(unit.generate_s / 2));
    const dialogue = (d?.dialogue ?? [])
      .map((x) => `${nameOf(input, x.speaker_id)}, ${x.delivery}: "${x.line}"`)
      .join(" ");
    lines.push(`[0-${half}s] ${scrub(d?.action ?? "")} ${dialogue}`.trim());
    lines.push(`[${half}-${unit.generate_s}s] ${scrub(d?.flex_content ?? "A held moment.")}`);
  } else {
    lines.push(...assetLines, stagingLine, opening, "Shots:");
    shotLines = (compact) =>
      unit.shots.map((s, i) => {
        const lead =
          s.cut_in === "first"
            ? "Shot 1 —"
            : s.cut_in === "no_cut"
              ? "No cut —"
              : `Cut to Shot ${i + 1} —`;
        return `[${s.window}] ${lead} ${shotLine(i, compact)}`;
      });
  }
  const lights = m.lightIds
    .map((id) => look.light_setups.find((s) => s.light_id === id)?.light_line ?? "")
    .filter((x) => x !== "");
  const lookLine = `Look: ${look.look_line} ${lights.join(" ")}`;
  const audioBase = `Audio: ${input.director.directors_notes.sound_world} ${[...new Set(m.directorShots.flatMap((s) => s.sound_cues))].join(", ")}.`;
  const negatives = `No subtitles. No text on screen.${unit.unit_type === "shot" ? " No cuts. One unbroken camera setup." : ""}`;
  const [min, max] = promptWordRange(input.platform_config, unit);
  let compact = false;
  const compose = (pad: string[]) =>
    [
      ...lines,
      ...shotLines(compact),
      lookLine,
      [audioBase, ...pad].join(" "),
      negatives,
      "END PROMPT",
    ].join("\n");
  const pad: string[] = [];
  let text = compose(pad);
  if (countWords(text) > max) {
    // The owner's trim order: composition phrases and framing details go first.
    compact = true;
    text = compose(pad);
  }
  for (let i = 0; countWords(text) < min && i < 60; i++) {
    pad.push(PADDING[i % PADDING.length] ?? "");
    text = compose(pad);
  }
  const count = countWords(text);
  const over = count > max;
  return {
    unit_id: unit.unit_id,
    unit_type: unit.unit_type,
    status: over ? "over_length" : "ok",
    duration_s: unit.duration_s,
    generate_s: unit.generate_s,
    assets: {
      characters: m.characters,
      locations: m.locations,
      props: m.props,
      heard_only: m.heardOnly,
    },
    light_ids: m.lightIds,
    dialogue_lines: m.lines.length,
    applied_rules: [],
    prompt_text: text,
    word_count: count,
    warnings: over
      ? [
          {
            type: "over_length",
            ref: String(unit.unit_id),
            message: `${count} words; no decision was dropped.`,
          },
        ]
      : [],
  };
}

export function samplePrompter(raw: unknown): PrompterOutput {
  const input = prompterInputSchema.parse(raw);
  const units = input.units.map((unit): PrompterUnit => {
    const m = unitMaterial(unit, input);
    if ("missing" in m) {
      return {
        unit_id: unit.unit_id,
        unit_type: unit.unit_type,
        status: "skipped",
        duration_s: unit.duration_s,
        generate_s: unit.generate_s,
        assets: { characters: [], locations: [], props: [], heard_only: [] },
        light_ids: [],
        dialogue_lines: 0,
        applied_rules: [],
        prompt_text: "",
        word_count: 0,
        warnings: [
          { type: "missing_shot_data", ref: m.missing.join(","), message: "Shot data is missing." },
        ],
      };
    }
    return writeUnit(unit, m, input);
  });
  const warned = units.some((u) => u.warnings.length > 0);
  return {
    dami: "prompter",
    dami_version: "1.0",
    status: warned ? "ok_with_warnings" : "ok",
    units,
    warnings: [],
  };
}
