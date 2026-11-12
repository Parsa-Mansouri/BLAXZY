/**
 * Sample-mode Prop Generator: a deterministic spec, DNA, sheet plan and hero_34 prompt built from
 * the input alone. A prop nothing is known about (no words, answers, photos or script) gets the
 * owner's one blocking question and no Hero; a building or room gets `NOT_A_PROP:`. A prop that
 * is an anchor of an approved location is reproduced from that location's Hero. Fix mode keeps
 * the previous answer and applies each request on top.
 */
import { isPropFix } from "../prop-generator/dami";
import { propSourceMode } from "../prop-generator/prompt";
import {
  propGeneratorInputSchema,
  propGeneratorOutputSchema,
  type PropGeneratorOutput,
  type PropGeneratorParsedInput,
} from "../prop-generator/schema";
import { AI_DECIDES } from "../shared/designer";
import { truncate } from "./util";

type Spec = PropGeneratorOutput["spec_fields"][number];

const NOT_A_PROP = /\b(castle|house|building|room|palace|street|village|city|hall)\b/i;
const TALL = /\b(sword|staff|lamp|lantern|bottle|candle|vase|spear|umbrella|statue)\b/i;
const WIDE = /\b(car|sofa|chest|table|crate|bench|boat|bed|trunk|desk)\b/i;
const CHANGING = /\b(open|opens|close|closed|lit|light|switch|lock|unlock|break|broken)\b/i;

function given(value: string | undefined): string | null {
  return value && value !== AI_DECIDES ? value : null;
}

function known(input: PropGeneratorParsedInput): boolean {
  return (
    input.userPrompt !== undefined ||
    given(input.guidedAnswers?.what_is_it) !== null ||
    input.referenceImages.length > 0 ||
    input.asset.scriptDescription.trim().length > 0 ||
    (input.scriptContext?.scenes.length ?? 0) > 0 ||
    Object.keys(input.clarifyAnswers ?? {}).length > 0
  );
}

function fresh(input: PropGeneratorParsedInput): PropGeneratorOutput {
  const { asset, project } = input;
  const answers = input.guidedAnswers ?? {};
  const words = [
    asset.name,
    asset.scriptDescription,
    input.userPrompt ?? "",
    given(answers.what_is_it) ?? "",
  ].join(" ");
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const scenes = input.scriptContext?.scenes ?? [];
  if (scenes.length === 0)
    warnings.push(
      "There is no script slice for this prop; it is designed from your input and the project.",
    );

  const importance = (given(answers.importance) ??
    (asset.categoryHint === "hero_prop"
      ? "hero"
      : asset.categoryHint === "set_dressing"
        ? "background"
        : "standard")) as PropGeneratorOutput["classification"]["importance"];
  const changes = CHANGING.test(words) || given(answers.usage) === "multi_state";
  const interaction: PropGeneratorOutput["classification"]["interaction"] = changes
    ? "multi_state"
    : given(answers.usage) === "carried" || asset.categoryHint === "hand_prop"
      ? "carried"
      : "static";
  const families: PropGeneratorOutput["classification"]["families"] = [
    ...(importance === "hero" ? (["hero_prop"] as const) : []),
    ...(interaction === "carried" ? (["hand_prop"] as const) : []),
    ...(interaction === "multi_state" ? (["functional_prop"] as const) : []),
  ];
  if (families.length === 0) families.push(interaction === "static" ? "set_dressing" : "hand_prop");

  const what =
    given(answers.what_is_it) ??
    input.clarifyAnswers?.identity ??
    (asset.scriptDescription || asset.name);
  const scale = given(answers.scale);
  if (!scale) assumptions.push("Sized it to fit in one hand.");
  const material = given(answers.advanced?.materials) ?? "aged brass with a dark wooden body";
  if (!given(answers.advanced?.materials)) assumptions.push(`Chose ${material} as the materials.`);
  const location = input.linkedLocations.find((l) => l.anchor && l.heroFileId);
  const identityRef = input.referenceImages.findIndex((r) => r.role === "identity");
  const status = (src: Spec["source"]): Spec["status"] =>
    src === "dami" ? "inferred" : "confirmed";
  const spec = (field: string, value: string, source: Spec["source"], critical = false): Spec => ({
    field,
    value,
    status: status(source),
    source,
    critical,
  });
  const fromWhat: Spec["source"] = given(answers.what_is_it)
    ? "guided_answer"
    : input.userPrompt
      ? "user"
      : asset.scriptDescription
        ? "script"
        : location
          ? "location"
          : identityRef >= 0
            ? "reference"
            : "dami";
  const spec_fields: Spec[] = [
    spec("what_is_it", truncate(what, 200), fromWhat, true),
    spec("silhouette", "Compact box with a rounded lid", location ? "location" : "dami", true),
    spec(
      "proportions",
      "1 : 1.2 : 0.8 (height : width : depth)",
      location ? "location" : "dami",
      true,
    ),
    spec("scale", scale ?? "Fits in one hand", scale ? "guided_answer" : "dami", true),
    spec(
      "materials",
      material,
      given(answers.advanced?.materials) ? "guided_answer" : "dami",
      true,
    ),
    spec("front_definition", "The face with the clasp", "dami", true),
    spec(
      "wear",
      given(answers.advanced?.wear) ?? "Light, honest wear on the edges",
      given(answers.advanced?.wear) ? "guided_answer" : "dami",
    ),
  ];
  if (given(answers.must_keep))
    spec_fields.push(spec("must_keep", given(answers.must_keep) ?? "", "guided_answer", true));
  if (identityRef >= 0) {
    spec_fields.push(
      spec("back_and_underside", "Plain, matching the front's material", "dami", true),
    );
    warnings.push(
      "One photo never shows the back or the underside: those sides are proposed design.",
    );
  }

  const states: PropGeneratorOutput["dna"]["states"] = [
    { state_id: "closed", name: "Closed", description: "At rest.", is_default: true },
    ...(interaction === "multi_state"
      ? [
          {
            state_id: "open",
            name: "Open",
            description: "Lid lifted, the inside visible.",
            is_default: false,
          },
        ]
      : []),
  ];
  const aspect = TALL.test(words) ? "3:4" : WIDE.test(words) ? "4:3" : "1:1";
  const style = project.styleDescriptor ?? `${project.style} rendering`;
  const userRefs = input.referenceImages.map((r, i) => ({
    index: i + 1,
    source: `user_reference:${i + 1}`,
    role: r.role,
  }));
  const referenceOrder = [
    ...userRefs,
    ...(location
      ? [{ index: userRefs.length + 1, source: `location_hero:${location.name}`, role: "location" }]
      : []),
  ].slice(0, 4);
  const heroSource = location ? "from_location" : identityRef >= 0 ? "from_reference" : "generate";

  const questions: PropGeneratorOutput["clarifying_questions"] = [];
  if (!scale && !input.clarifyAnswers?.size) {
    const options = [
      "Fits in one hand",
      "Held with two hands",
      "As tall as a table",
      "As tall as a person",
    ];
    questions.push({
      id: "size",
      field: "scale",
      question: `How big is ${asset.name}?`,
      options,
      default: options[0] ?? "",
      blocking: false,
    });
  }

  const level =
    interaction === "multi_state" || importance === "hero"
      ? "production"
      : importance === "background"
        ? "simple"
        : "standard";
  const views =
    level === "simple"
      ? []
      : level === "standard"
        ? [
            { view_id: "back_34", purpose: "What the hero view hides." },
            { view_id: "detail_1", purpose: "The clasp up close." },
            { view_id: "scale_ref", purpose: "True size beside a hand." },
          ]
        : [
            { view_id: "front", purpose: "The front face straight on." },
            { view_id: "right", purpose: "The right side." },
            { view_id: "back", purpose: "The back face, never a mirror of the front." },
            { view_id: "left", purpose: "The left side." },
            { view_id: "detail_1", purpose: "The clasp up close." },
            { view_id: "detail_2", purpose: "The hinge up close." },
            ...states
              .filter((s) => !s.is_default)
              .map((s) => ({
                view_id: `state_${s.state_id}`,
                purpose: `The object ${s.name.toLowerCase()}.`,
              })),
            ...(interaction === "carried"
              ? [{ view_id: "interaction", purpose: "How a hand holds it." }]
              : []),
            { view_id: "scale_ref", purpose: "True size beside a hand." },
          ];

  const prompt = [
    `${truncate(what, 200)}, rendered as ${style}.`,
    "Hero three-quarter view between the front and right faces, camera 15 to 20 degrees above the object's centre, the whole object in frame with a comfortable margin.",
    `A compact box with a rounded lid, proportions 1 : 1.2 : 0.8, made of ${material}.`,
    "The clasp sits on the front face, on the viewer's left half; the right face is on the viewer's right.",
    location
      ? `Reproduce the object exactly as it appears in the attached ${location.name} Hero, isolated on the studio.`
      : "",
    identityRef >= 0
      ? "Use the first reference image as the exact object: keep its shape, proportions and details. Ignore its background, lighting and any hands holding it."
      : "",
    "Default state: closed.",
    "Seamless neutral mid-grey background, soft even studio light, long-lens perspective.",
    "No hands, people, other objects, labels or text.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    asset_id: asset.name,
    asset_name: asset.name,
    source_mode: propSourceMode(input),
    script_analysis: {
      role_in_story: scenes.length > 0 ? `${asset.name} is handled in the scene.` : "",
      actions_on_object: scenes.map((s) =>
        truncate(`Scene ${s.sceneNumber}: ${s.action || s.heading}`, 200),
      ),
      required_features: [],
      required_states: states.filter((s) => !s.is_default).map((s) => s.name),
      dramatic_weight: scenes.length > 0 ? "It should be noticed." : "",
    },
    classification: {
      families,
      importance,
      interaction,
      complexity: interaction === "multi_state" ? "medium" : "low",
    },
    spec_fields,
    clarifying_questions: questions,
    dna: {
      object_type: truncate(what, 120),
      front_definition: "The face with the clasp",
      geometry: {
        silhouette: "Compact box with a rounded lid",
        proportions: "1 : 1.2 : 0.8 (height : width : depth)",
        rest_orientation: "Rests on its flat base, lid up",
        parts: [
          {
            part_id: "body",
            name: "Body",
            attaches_to: "none",
            face: "whole",
            description: "The main box.",
          },
          {
            part_id: "lid",
            name: "Lid",
            attaches_to: "body",
            face: "T",
            description: "Rounded, hinged at the back.",
          },
        ],
      },
      scale: {
        size_class: scale?.startsWith("large")
          ? "large"
          : scale?.startsWith("medium")
            ? "medium"
            : "hand_held",
        dimensions_cm: null,
        dimensions_status: "inferred",
        relative_reference: scale ?? "About the size of an adult palm",
        scale_reference_type: scale?.startsWith("large") ? "human_figure" : "hand",
      },
      materials: [
        { part_id: "body", material, finish: "satin", color: "warm brown", wear: "light" },
      ],
      palette: ["warm brown", "dull brass"],
      signature_details: [
        {
          detail_id: "clasp",
          description: "A small brass clasp",
          face: "F",
          position: "upper-left of FRONT",
          asymmetric: true,
          is_text: false,
          text_content: null,
          render_as: "as_designed",
        },
      ],
      states,
      mechanics:
        interaction === "multi_state"
          ? [
              {
                mechanism_id: "hinge",
                type: "hinge",
                part_id: "lid",
                how: "Hinged along the back edge, opens up to 100 degrees.",
              },
            ]
          : [],
      must_keep: given(answers.must_keep) ? [given(answers.must_keep) ?? ""] : [],
      must_not: ["No real brand names or logos"],
      mutable: ["Dust", "Contents"],
    },
    project_links: {
      scene_refs: asset.sceneRefs,
      character_links: input.linkedCharacters.map((c) => ({
        character_id: c.name,
        usage: c.usageNote || "Handles it",
        hand: c.handedness === "left" ? "left" : c.handedness === "right" ? "right" : "unknown",
      })),
      location_links: input.linkedLocations.map((l) => ({
        location_id: l.name,
        anchor_id: l.anchor,
        placement_hint: l.anchor
          ? `Where the ${l.name} Hero shows it`
          : "On the table by the north wall",
        facing: "S",
      })),
    },
    sheet_plan: {
      level,
      level_reason: `${importance} importance, ${interaction.replace("_", " ")} use.`,
      views,
    },
    hero_view: {
      view_id: "hero_34",
      hero_source: heroSource,
      state_id: "closed",
      image_prompt: prompt,
      aspect_ratio: aspect,
      reference_order: referenceOrder,
      must_show: ["The clasp on the front face"],
      must_not_show: ["Hands", "Text"],
    },
    changes_identity: false,
    style_used: style,
    style_source: input.styleOverride ? "style_override" : "project_style",
    applied_fixes: [],
    assumptions,
    warnings,
  };
}

function blocked(input: PropGeneratorParsedInput, warning: string | null): PropGeneratorOutput {
  const base = fresh(input);
  const options = ["A tool", "A container", "A device", "A piece of jewellery"];
  return {
    ...base,
    clarifying_questions: warning
      ? []
      : [
          {
            id: "identity",
            field: "what_is_it",
            question: `What kind of object is ${input.asset.name}?`,
            options,
            default: "A device",
            blocking: true,
          },
        ],
    hero_view: null,
    warnings: warning ? [warning, ...base.warnings] : base.warnings,
  };
}

export function samplePropGenerator(raw: unknown): PropGeneratorOutput {
  const input = propGeneratorInputSchema.parse(raw);
  if (NOT_A_PROP.test(input.asset.name)) {
    return blocked(
      input,
      `NOT_A_PROP: ${input.asset.name} is a place, not an object. Design it with the Location Generator.`,
    );
  }
  if (!isPropFix(input)) return known(input) ? fresh(input) : blocked(input, null);
  const previous = propGeneratorOutputSchema.safeParse(input.previousOutput);
  const base = previous.success && previous.data.hero_view ? previous.data : fresh(input);
  const hero = base.hero_view ?? fresh(input).hero_view;
  const additions = [
    ...input.fixRequests.map((f) =>
      f.customText ? `${f.instruction} (${f.customText})` : f.instruction,
    ),
    ...(input.userNotes ? [`Director's note: ${input.userNotes}`] : []),
  ];
  const identityCodes = new Set(["AP01", "AP02", "AP03", "AP09", "AP10", "SPEC_EDIT"]);
  const userRefs = input.referenceImages.length;
  return {
    ...base,
    clarifying_questions: base.clarifying_questions.filter(
      (q) => !(input.clarifyAnswers && q.id in input.clarifyAnswers),
    ),
    hero_view: hero && {
      ...hero,
      image_prompt: truncate(
        `${hero.image_prompt.replace(/[.\s]+$/, "")}. ${additions.join(" ")}`,
        6000,
      ),
      // Dropped references are no longer attached.
      reference_order: hero.reference_order.filter((r) => {
        const m = /^user_reference:(\d+)$/.exec(r.source);
        return m
          ? Number(m[1]) <= userRefs
          : input.linkedLocations.some(
              (l) => l.heroFileId && r.source === `location_hero:${l.name}`,
            );
      }),
      hero_source:
        hero.hero_source === "from_reference" && userRefs === 0 ? "generate" : hero.hero_source,
    },
    changes_identity: input.fixRequests.some((f) => identityCodes.has(f.code)),
    style_source: input.styleOverride ? "style_override" : "project_style",
    applied_fixes: input.fixRequests.map((f) => ({
      code: f.code,
      change: truncate(`Applied: ${f.instruction}`, 300),
    })),
    warnings: [],
  };
}
