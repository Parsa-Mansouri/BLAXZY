/**
 * Sample Creative DNA: a deterministic Creative Bible built from the input and the registry, with
 * no Claude call. The block math and the dialogue budget are the real ones; the rules come from
 * the modules' own English text (SCREENPLAY, DIRECTING, IMAGE_PROMPT and VIDEO_PROMPT
 * paragraphs), the guards from their must-nots, and the QC items from their criteria.
 */
import { CREATIVE_DNA_VERSION } from "../creative-dna/dami";
import {
  CREATIVE_REGISTRY,
  getCreativeModule,
  type CreativeModule,
} from "../creative-dna/registry";
import {
  creativeBibleSchema,
  creativeDnaInputSchema,
  REVIEW_POINTS,
  type CreativeBible,
  type CreativeDnaInput,
  type CreativeReviewOption,
  type CreativeRule,
  type ReviewPoint,
} from "../creative-dna/schema";
import { PLATFORM_CONFIG, speechRateWps } from "../shared/platform";
import { truncate } from "./util";

type Source = "genre" | "style" | "combo" | "frame";
type Section = "SCREENPLAY" | "DIRECTING" | "IMAGE_PROMPT" | "VIDEO_PROMPT";

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The sentences of a module's `In SECTION, ...` paragraph, as imperatives. */
function sectionSentences(module: CreativeModule, section: Section): string[] {
  const prefix = `In ${section}, `;
  const paragraph = module.specialization_en.split(/\n\s*\n/).find((p) => p.startsWith(prefix));
  return paragraph ? sentences(capitalize(paragraph.slice(prefix.length))) : [];
}

/** The module's opening paragraph without its "Act as the ..." sentence. */
function introSentences(module: CreativeModule): string[] {
  const first = module.specialization_en.split(/\n\s*\n/)[0] ?? "";
  return sentences(first).slice(1);
}

function doNotSentences(module: CreativeModule): string[] {
  return sentences(module.specialization_en).filter((s) => /^(Do not|Never)\b/.test(s));
}

type Frame = {
  blockLength: number;
  blocks: number | null;
  maxWords: number | null;
  maxEvents: number;
};

function frameOf(input: CreativeDnaInput): Frame {
  const episodeSeconds = input.episode_duration_sec ?? input.total_duration_sec ?? null;
  // Longer pieces that split evenly into 30 s blocks use them; everything else the default.
  const blockLength =
    input.block_length_sec ??
    (episodeSeconds !== null && episodeSeconds >= 300 && episodeSeconds % 30 === 0
      ? 30
      : PLATFORM_CONFIG.default_block_length_sec);
  const events: Readonly<Record<string, number>> = PLATFORM_CONFIG.max_events_per_block;
  return {
    blockLength,
    blocks: episodeSeconds === null ? null : Math.ceil(episodeSeconds / blockLength),
    // Speech fills at most 70% of a block: 30% stays for action and reaction.
    maxWords:
      input.dialogue_policy === "none"
        ? 0
        : Math.floor(speechRateWps(input.script_language) * blockLength * 0.7),
    maxEvents: events[String(blockLength)] ?? 2,
  };
}

function orientationRules(orientation: CreativeDnaInput["orientation"]): string[] {
  if (orientation === "portrait") {
    return [
      "Stage key action center-weighted in the vertical 9:16 frame, stacking foreground and background, with the top and bottom safe zones free of essential action.",
      "Keep fewer characters in frame at once so each stays readable at phone size.",
    ];
  }
  if (orientation === "square") {
    return ["Compose for the 1:1 frame: key action centered with even margins on every side."];
  }
  return [
    "Use lateral blocking across the 16:9 width and keep key action inside the central safe area.",
  ];
}

class RuleList {
  private readonly rules: CreativeRule[] = [];
  constructor(private readonly prefix: string) {}

  add(text: string, source: Source): void {
    const rule = truncate(text, 300);
    if (this.rules.some((r) => r.rule === rule)) return;
    const n = String(this.rules.length + 1).padStart(2, "0");
    this.rules.push({ id: `${this.prefix}_${n}`, rule, source });
  }

  list(): CreativeRule[] {
    return this.rules;
  }
}

/** A slice's rules: sentences of both modules' paragraph for it, then the project-frame rules. */
function sliceRules(
  prefix: string,
  sections: readonly Section[],
  genre: CreativeModule,
  style: CreativeModule,
  frameRules: readonly string[],
): CreativeRule[] {
  const rules = new RuleList(prefix);
  for (const [module, source] of [
    [genre, "genre"],
    [style, "style"],
  ] as const) {
    const own = sections.flatMap((s) => sectionSentences(module, s)).slice(0, 4);
    for (const sentence of own.length >= 2 ? own : [...own, ...introSentences(module)]) {
      rules.add(sentence, source);
    }
  }
  for (const text of frameRules) rules.add(text, "frame");
  return rules.list();
}

const GENRE_STAGES = ["script", "script", "asset", "sheet", "text_block", "video"] as const;
const STYLE_STAGES = ["asset", "sheet", "text_block", "video", "video", "all"] as const;
const POINT_NAMES: Readonly<Record<ReviewPoint, string>> = {
  script: "script",
  asset: "asset",
  sheet: "sheet",
  text_block: "text block",
  video: "video",
};

function reviewOptions(
  point: ReviewPoint,
  genre: CreativeModule,
  style: CreativeModule,
  orientation: string,
): { technical: CreativeReviewOption[]; preference: CreativeReviewOption[] } {
  const name = POINT_NAMES[point];
  const option = (
    kind: "tech" | "pref",
    key: string,
    label: string,
    fix: string,
  ): CreativeReviewOption => ({
    id: `${point}_${kind}_${key}`,
    label,
    fix_instruction: fix,
    target_stage: point,
  });
  return {
    technical: [
      option(
        "tech",
        "style_drift",
        `The ${style.name_en} look is not consistent in the ${name}`,
        `Restore the ${style.name_en} presentation rules of the Creative Bible; leave the story content unchanged.`,
      ),
      option(
        "tech",
        "genre_logic",
        `The ${genre.name_en} feel is lost in the ${name}`,
        `Restore the ${genre.name_en} narrative logic of the Creative Bible without changing the medium or the look.`,
      ),
      option(
        "tech",
        "added_content",
        `Something appears in the ${name} that was never in the script`,
        "Remove every character, event, setting or ending the script and the project locks do not authorize.",
      ),
      option(
        "tech",
        "framing",
        `The ${orientation} framing does not fit in the ${name}`,
        `Re-compose for the ${orientation} frame following the orientation rules of the Creative Bible.`,
      ),
    ],
    preference: [
      option(
        "pref",
        "calmer",
        "Make it calmer",
        `Lower the intensity within ${genre.name_en} and ${style.name_en}; keep every approved event.`,
      ),
      option(
        "pref",
        "more_intense",
        "Make it more intense",
        `Raise the intensity within ${genre.name_en} and ${style.name_en}; keep every approved event.`,
      ),
      option(
        "pref",
        "simpler_setting",
        "Simplify the surroundings",
        "Reduce background detail so the main action reads first; keep every locked location element.",
      ),
      option(
        "pref",
        "warmer_mood",
        "Make the mood warmer",
        `Warm the mood within the ${style.name_en} light and color language; do not change the genre.`,
      ),
    ],
  };
}

export function sampleCreativeDna(raw: unknown): CreativeBible {
  const input: CreativeDnaInput = creativeDnaInputSchema.parse(raw);
  const genre = getCreativeModule(input.genre_id);
  const style = getCreativeModule(input.style_id);
  const frame = frameOf(input);
  const policy = input.dialogue_policy ?? null;

  const blockRule = `Plan each block as a ${frame.blockLength}-second unit with at most ${frame.maxEvents} distinct events.`;
  const dialogueRule =
    frame.maxWords === 0
      ? "Write no spoken dialogue; carry every beat through action, reaction and sound."
      : frame.maxWords !== null
        ? `Keep spoken lines within ${frame.maxWords} words per block, leaving at least 30% of each block for action and reaction.`
        : null;
  const orientation = orientationRules(input.orientation);
  const series = input.format === "series";

  const lastBlock = frame.blocks;
  const beatGuidance =
    lastBlock === null
      ? ["Size the beats to the blocks once the duration is known."]
      : lastBlock === 1
        ? ["One block: show the desire, the resistance and the visible change in a single unit."]
        : [
            "Block 1: establish the situation and what the central character wants.",
            ...(lastBlock > 2
              ? [
                  `Blocks 2 to ${lastBlock - 1}: build resistance, the choice and its cost, one visible beat each.`,
                ]
              : []),
            `Block ${lastBlock}: the change must be visible; end on a reaction, not a line.`,
          ];

  const qc: CreativeBible["qc_checklist"] = [];
  const addCriteria = (
    module: CreativeModule,
    source: "genre" | "style",
    stages: readonly string[],
  ) =>
    module.qc_criteria_fa.forEach((criterion, i) =>
      qc.push({
        id: `${source}_qc_${String(i + 1).padStart(2, "0")}`,
        type: "criterion",
        source,
        stage: (stages[i] ?? "all") as CreativeBible["qc_checklist"][number]["stage"],
        // Sample only: the module's own wording, not translated.
        criterion,
        how_to_check:
          "Compare the stage output with this criterion and point to the line or frame that meets or breaks it.",
      }),
    );
  addCriteria(genre, "genre", GENRE_STAGES);
  addCriteria(style, "style", STYLE_STAGES);
  for (const [module, source] of [
    [genre, "genre"],
    [style, "style"],
  ] as const) {
    module.boundary_tests_fa.forEach((test, i) =>
      qc.push({
        id: `${source}_boundary_${String(i + 1).padStart(2, "0")}`,
        type: "boundary_test",
        source,
        stage: "all",
        criterion: test,
        how_to_check: "Run the boundary test on the stage output and report whether it holds.",
      }),
    );
  }
  qc.push(
    {
      id: "combo_01",
      type: "criterion",
      source: "combo",
      stage: "all",
      criterion: `${genre.name_en} keeps the story logic and ${style.name_en} keeps the presentation; neither changes the other's domain.`,
      how_to_check:
        "Check that no rule or output changes the medium because of the genre, or the plot because of the style.",
    },
    {
      id: "frame_01",
      type: "criterion",
      source: "frame",
      stage: "text_block",
      criterion: `Each block fits ${frame.blockLength} seconds with at most ${frame.maxEvents} distinct events.`,
      how_to_check: "Count the events of each block and compare with its length.",
    },
    {
      id: "frame_02",
      type: "criterion",
      source: "frame",
      stage: "video",
      criterion: `The framing follows the ${input.orientation} orientation rules.`,
      how_to_check: "Check the key action position and the safe zones in a frame of the clip.",
    },
  );

  const guards: CreativeBible["anti_cliche_guards"] = [];
  for (const [module, source] of [
    [genre, "genre"],
    [style, "style"],
  ] as const) {
    for (const guard of [...module.must_nots_fa, ...doNotSentences(module)]) {
      guards.push({ guard, source });
    }
  }
  guards.push({
    guard: "Do not let the style add story content, or the genre change the medium.",
    source: "combo",
  });

  const assumptions = [
    `Block length ${frame.blockLength} s${frame.blockLength === PLATFORM_CONFIG.default_block_length_sec ? " (the platform default)" : " (the duration splits evenly into longer blocks)"}.`,
    "Sample output: the rules are taken from the modules' own text, not compiled by Claude.",
  ];

  const bible: CreativeBible = {
    dami: "creative_dna",
    dami_version: CREATIVE_DNA_VERSION.split(".").slice(0, 2).join("."),
    registry_version: CREATIVE_REGISTRY.version,
    selection: { genre_id: genre.id, style_id: style.id },
    project_frame: {
      format: input.format,
      episode_count: input.episode_count ?? null,
      episode_duration_sec: input.episode_duration_sec ?? null,
      total_duration_sec: input.total_duration_sec ?? null,
      orientation: input.orientation,
      audience: input.audience ?? null,
      script_language: input.script_language ?? null,
      ui_language: input.ui_language,
      dialogue_policy: policy,
      block_length_sec: frame.blockLength,
      blocks_per_episode: frame.blocks,
      max_spoken_words_per_block: frame.maxWords,
    },
    contracts: {
      genre_contract: introSentences(genre).slice(0, 2).join(" "),
      style_contract: introSentences(style).slice(0, 2).join(" "),
      combination_logic: `${genre.name_en} owns the story logic and ${style.name_en} owns the presentation; neither changes the other's domain, and the project's locks win over both.`,
    },
    slices: {
      for_script_writer: {
        rules: sliceRules("sw", ["SCREENPLAY"], genre, style, [
          blockRule,
          ...(dialogueRule ? [dialogueRule] : []),
        ]),
        beat_guidance: beatGuidance,
        series_rules: series
          ? [
              {
                id: "sw_series_01",
                rule: "Give every episode its own unit of change and end it on a visible condition.",
                source: "frame",
              },
              {
                id: "sw_series_02",
                rule: "Keep locked assets, world rules and tone identical across episodes.",
                source: "frame",
              },
            ]
          : [],
      },
      for_script_checker: {
        rules: sliceRules("sc", ["SCREENPLAY"], genre, style, dialogueRule ? [dialogueRule] : []),
      },
      for_asset_detector: {
        rules: sliceRules("ad", ["IMAGE_PROMPT"], genre, style, []),
        attributes_to_capture: [
          {
            asset_type: "character",
            attributes: [
              `How a character is rendered in ${style.name_en}: medium, line or material language`,
            ],
          },
          {
            asset_type: "location",
            attributes: ["Every light source in the place, named (lamp, window, screen, sun)"],
          },
          {
            asset_type: "prop",
            attributes: [`The material and surface of the prop in ${style.name_en}`],
          },
        ],
      },
      for_asset_generation: {
        rules: sliceRules("ag", ["IMAGE_PROMPT"], genre, style, orientation),
        guided_question_focus: [
          {
            asset_type: "character",
            focus: ["Posture, distance and attention that carry the genre"],
          },
          { asset_type: "location", focus: ["Where the light comes from and what it touches"] },
        ],
      },
      for_sheet_generator: {
        rules: sliceRules("sg", ["IMAGE_PROMPT"], genre, style, orientation),
        locks_to_capture: input.locks ?? [],
      },
      for_director: {
        rules: sliceRules("dr", ["DIRECTING"], genre, style, [...orientation, blockRule]),
      },
      for_text_blocks_video: {
        rules: sliceRules("tb", ["VIDEO_PROMPT"], genre, style, [blockRule]),
      },
    },
    continuity_locks: [
      ...(input.locks ?? []),
      `The ${input.orientation} orientation stays the same in every stage.`,
    ],
    anti_cliche_guards: guards,
    qc_checklist: qc,
    review_options: Object.fromEntries(
      REVIEW_POINTS.map((p) => [p, reviewOptions(p, genre, style, input.orientation)]),
    ) as CreativeBible["review_options"],
    conflicts: [],
    open_questions: [],
    assumptions,
    validation_status: "ok_with_assumptions",
  };
  return creativeBibleSchema.parse(bible);
}
