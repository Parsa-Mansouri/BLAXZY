/**
 * Sample-mode Location Generator: a deterministic spec, DNA, four-wall layout, coverage plan and
 * Hero prompt built from the input alone. Answers from the user are confirmed, the script's facts
 * are confirmed (source script), everything else is designed (inferred, critical for geometry,
 * openings and anchors). A Hero reference is used as is unless a note asks for a change (then it
 * is restyled). Fix mode keeps the previous answer's ids and applies each request on top.
 */
import { isLocationFix } from "../location-generator/dami";
import {
  locationGeneratorInputSchema,
  locationGeneratorOutputSchema,
  type LocationGeneratorOutput,
  type LocationGeneratorParsedInput,
} from "../location-generator/schema";
import { AI_DECIDES } from "../shared/designer";
import { truncate } from "./util";

type Field = LocationGeneratorOutput["spec_fields"][number];

function answer(input: LocationGeneratorParsedInput, id: string): string | null {
  const value = input.guidedAnswers?.[id];
  return value && value !== AI_DECIDES ? value : null;
}

function sourceMode(input: LocationGeneratorParsedInput): LocationGeneratorOutput["source_mode"] {
  const text =
    input.userPrompt !== undefined ||
    Object.values(input.guidedAnswers ?? {}).some((v) => v !== AI_DECIDES);
  const refs = input.referenceImages.length > 0;
  if (text && refs) return "prompt_reference";
  if (refs) return "reference_only";
  return text ? "prompt_only" : "auto";
}

function coverage(
  interior: boolean,
  mode: "concept" | "lock",
): LocationGeneratorOutput["coverage_plan"]["views"] {
  const view = (view_id: string, name: string, camera_id: string, purpose: string) => ({
    view_id,
    name,
    camera_id,
    purpose,
    required:
      view_id === "hero_wide" || view_id.startsWith("reverse") || view_id === "establishing_wide",
  });
  if (interior) {
    return mode === "concept"
      ? [
          view("hero_wide", "Hero Wide", "hero_wide", "The master view of the room."),
          view("alternate", "Alternate", "reverse_wide", "The wall behind the Hero camera."),
          view("detail_1", "Door", "hero_wide", "The way in, which the story uses."),
          view("detail_2", "Window", "hero_wide", "The main light source."),
        ]
      : [
          view("hero_wide", "Hero Wide", "hero_wide", "The master view of the room."),
          view("reverse_wide", "Reverse Wide", "reverse_wide", "The wall behind the Hero camera."),
          view("corner_a", "Corner A", "corner_a", "North and east walls together."),
          view("corner_b", "Corner B", "corner_b", "West and north walls together."),
          view("side_west", "Side West", "side_west", "The east wall straight on."),
          view("detail_1", "Door", "hero_wide", "The way in, which the story uses."),
          view("detail_2", "Window", "hero_wide", "The main light source."),
        ];
  }
  return mode === "concept"
    ? [
        view("establishing_wide", "Establishing Wide", "establishing_wide", "The site as a whole."),
        view("reverse_establishing", "Reverse", "reverse_establishing", "Looking back out."),
        view("detail_1", "Entrance", "human_level", "The way in."),
        view("detail_2", "Surface", "human_level", "The main material up close."),
      ]
    : [
        view("establishing_wide", "Establishing Wide", "establishing_wide", "The site as a whole."),
        view("reverse_establishing", "Reverse", "reverse_establishing", "Looking back out."),
        view("approach_left", "Approach Left", "approach_left", "Arriving from the south-west."),
        view("approach_right", "Approach Right", "approach_right", "Arriving from the south-east."),
        view("human_level", "Human Level", "human_level", "The facade at eye height."),
        view("detail_1", "Entrance", "human_level", "The way in."),
        view("detail_2", "Surface", "human_level", "The main material up close."),
        view("environmental_context", "Context", "establishing_wide", "What surrounds it."),
      ];
}

function cameras(interior: boolean): LocationGeneratorOutput["layout"]["cameras"] {
  const cam = (id: string, stands_at: string, looks_toward: string) => ({
    id,
    view: id,
    stands_at,
    looks_toward,
  });
  return interior
    ? [
        cam("hero_wide", "S", "N"),
        cam("reverse_wide", "N", "S"),
        cam("corner_a", "SW", "NE"),
        cam("corner_b", "SE", "NW"),
        cam("side_west", "W", "E"),
      ]
    : [
        cam("establishing_wide", "far S", "N"),
        cam("reverse_establishing", "N", "S"),
        cam("approach_left", "SW", "NE"),
        cam("approach_right", "SE", "NW"),
        cam("human_level", "S at 1.7 m", "N"),
      ];
}

function fresh(input: LocationGeneratorParsedInput): LocationGeneratorOutput {
  const { location, project } = input;
  const interior = (answer(input, "interior_exterior") ?? location.interiorExterior) !== "exterior";
  const scenes = input.scriptContext?.scenes ?? [];
  const user = (id: string) => answer(input, id);
  const assumptions: string[] = [];
  const warnings: string[] = [];
  if (scenes.length === 0) {
    warnings.push(
      "There is no script slice for this place; it is designed from your input, genre and style.",
    );
  }
  const what = user("what_is_it") ?? (location.scriptDescription || location.name);
  const materials = user("materials_colors");
  const light = user("light_atmosphere") ?? location.timeOfDay ?? null;
  const shape = user("shape_size");
  if (!materials)
    assumptions.push("Chose weathered plaster, dark wood and worn stone as the materials.");
  if (!shape) assumptions.push("Designed it as one rectangular room about 6 by 5 metres.");
  if (!light) assumptions.push("Lit it with soft daylight from the main window.");
  assumptions.push("The wall behind the Hero camera is proposed design: no source shows it.");

  const field = (
    group: Field["group"],
    name: string,
    value: string,
    from: Field["source"] | null,
    critical = false,
  ): Field => ({
    group,
    field: name,
    value,
    status: from === "design" || from === "genre_style" || from === null ? "inferred" : "confirmed",
    source: from ?? "design",
    critical,
  });
  const scriptOr = (given: string | null, fromScript: boolean): Field["source"] =>
    given ? "user" : fromScript ? "script" : "design";

  const spec_fields: Field[] = [
    field(
      "Identity",
      "Type",
      truncate(what, 200),
      user("what_is_it") ? "user" : location.scriptDescription ? "script" : "design",
    ),
    field(
      "Identity",
      "Inside or outside",
      interior ? "Interior" : "Exterior",
      scriptOr(user("interior_exterior"), location.interiorExterior !== undefined),
    ),
    field(
      "Identity",
      "Narrative role",
      user("narrative_function") ??
        (scenes.length > 0 ? "Where the scene's turn happens" : "A place the story passes through"),
      scenes.length > 0 ? "script" : user("narrative_function") ? "user" : "design",
    ),
    field(
      "Spatial",
      "Form and size",
      shape ??
        (interior
          ? "Rectangular, about 6 m wide, 5 m deep, 3 m high"
          : "An open site about 20 by 15 m"),
      shape ? "user" : "design",
      true,
    ),
    field(
      "Spatial",
      "Openings",
      interior
        ? "Door in the west wall, window in the north wall"
        : "Entrance in the middle of the south facade",
      "design",
      true,
    ),
    field(
      "Visual",
      "Era",
      project.eraSetting ?? user("era_world") ?? "Contemporary",
      project.eraSetting ? "script" : user("era_world") ? "user" : "genre_style",
    ),
    field(
      "Visual",
      "Materials and colours",
      materials ?? "Weathered plaster, dark wood, worn stone",
      materials ? "user" : "genre_style",
    ),
    field(
      "Environment",
      "Base light",
      light ?? "Soft daylight from the window",
      light ? (user("light_atmosphere") ? "user" : "script") : "genre_style",
    ),
    field(
      "Continuity",
      "Fixed anchors",
      interior ? "The door, the window and the long table" : "The entrance and the lamp post",
      "design",
      true,
    ),
  ];
  if (user("fixed_elements")) {
    spec_fields.push(field("Continuity", "Must stay", user("fixed_elements") ?? "", "user", true));
  }

  const anchors = interior
    ? [
        { id: "door_w", name: "Door", where: "W wall, position 30%", status: "inferred" as const },
        {
          id: "window_n",
          name: "Window",
          where: "N wall, position 50%",
          status: "inferred" as const,
        },
        {
          id: "table",
          name: "Long table",
          where: "Centre of the room",
          status: "inferred" as const,
        },
      ]
    : [
        {
          id: "entrance_s",
          name: "Entrance",
          where: "S facade, position 50%",
          status: "inferred" as const,
        },
        {
          id: "lamp",
          name: "Lamp post",
          where: "S edge, position 80%",
          status: "inferred" as const,
        },
      ];
  const heroRef = input.referenceImages.findIndex((r) => r.role === "hero");
  const restyle = heroRef >= 0 && (input.userPrompt !== undefined || input.userNotes !== undefined);
  const heroMode = heroRef < 0 ? "generate" : restyle ? "restyle_uploaded" : "use_uploaded";
  const style = project.styleDescriptor ?? `${project.style} rendering`;
  const prompt =
    heroMode === "use_uploaded"
      ? ""
      : [
          interior
            ? `Hero wide view of ${location.name} from the middle of the south wall looking north, one continuous 16:9 frame.`
            : `Establishing wide view of ${location.name} from far to the south looking north at the facade, one continuous 16:9 frame.`,
          `${truncate(what, 300)}.`,
          interior
            ? "The north wall fills the centre with a tall window at its middle; the west wall on the left has a wooden door in its near third; the east wall on the right is plain plaster; a long table stands in the centre."
            : "The entrance sits in the middle of the facade; a lamp post stands at the right edge of the frame.",
          `Materials and colours: ${materials ?? "weathered plaster, dark wood and worn stone"}.`,
          `Light and atmosphere: ${light ?? "soft daylight"}, structure clear of deep shadow.`,
          heroMode === "restyle_uploaded"
            ? "Keep the architecture, layout and composition of the first reference image exactly and re-render it in the project style."
            : "",
          `Rendered as ${style}.`,
          "Empty of people and animals; no text, labels, panels or watermarks.",
        ]
          .filter(Boolean)
          .join(" ");
  return {
    asset_id: location.name,
    location_name: location.name,
    source_mode: sourceMode(input),
    narrative_analysis: {
      dramatic_core:
        scenes.length > 0 ? truncate(`${location.name} holds the scene's turning point.`, 200) : "",
      location_role: scenes.length > 0 ? "It stages the confrontation." : "",
      events: scenes.map((s) => ({
        scene_number: Number.parseInt(s.sceneNumber, 10) || 0,
        what_happens: truncate(s.action || s.heading, 200),
        characters_present: s.charactersPresent.length,
      })),
      spatial_demands:
        scenes.length > 0
          ? [{ demand: "A clear entrance on the left", serves: "Entrances and exits" }]
          : [],
      movement_paths: scenes.length > 0 ? ["From the door to the table"] : [],
      emotional_arc: scenes.length > 0 ? "From quiet to tense" : "",
      mood_target: light ?? "Quiet",
    },
    spec_fields,
    dna: {
      geometry: interior
        ? "Rectangular room, flat ceiling"
        : "Open site in front of a single facade",
      fixed_anchors: anchors,
      visual_identity: {
        era: project.eraSetting ?? "Contemporary",
        architectural_style: "Plain vernacular",
        materials: (materials ?? "plaster, dark wood, stone").split(/,\s*/).slice(0, 4),
        base_palette: ["warm grey", "umber", "off-white"],
        wear_level: "Lived in",
        scale: interior ? "Human scale, one room" : "Street scale",
      },
      continuity_constraints: [
        "No additional doors, windows or fixed structures may be invented in later views.",
        ...(user("fixed_elements") ? [user("fixed_elements") ?? ""] : []),
      ],
      mutable_elements: ["Time of day", "Light intensity", "Weather", "Movable objects"],
    },
    layout: {
      space_kind: interior ? "interior" : "exterior",
      shape: interior ? "rectangle" : "open site",
      approx_size: interior
        ? { width_m: 6, depth_m: 5, height_m: 3 }
        : { width_m: 20, depth_m: 15, height_m: 8 },
      zones: [
        { id: "centre", name: "Centre", area: interior ? "Middle of the room" : "Forecourt" },
      ],
      openings: interior
        ? [
            {
              id: "door_w",
              type: "door",
              side: "W",
              position_pct: 30,
              size: "0.9 x 2.1 m",
              state: "closed",
              status: "inferred",
            },
            {
              id: "window_n",
              type: "window",
              side: "N",
              position_pct: 50,
              size: "1.4 x 1.6 m",
              state: "closed",
              status: "inferred",
            },
          ]
        : [
            {
              id: "entrance_s",
              type: "door",
              side: "S",
              position_pct: 50,
              size: "1.2 x 2.4 m",
              state: "open",
              status: "inferred",
            },
          ],
      key_objects: interior
        ? [
            {
              id: "table",
              name: "Long table",
              side_or_zone: "centre",
              position_pct: null,
              size: "2.4 x 0.9 m",
              fixed: true,
              status: "inferred",
            },
          ]
        : [
            {
              id: "lamp",
              name: "Lamp post",
              side_or_zone: "S",
              position_pct: 80,
              size: "4 m tall",
              fixed: true,
              status: "inferred",
            },
          ],
      cameras: cameras(interior),
      paths: [{ from: interior ? "door_w" : "entrance_s", to: "centre", note: "The way in" }],
    },
    coverage_plan: { mode: input.outputMode, views: coverage(interior, input.outputMode) },
    hero_wide: {
      mode: heroMode,
      image_prompt: prompt,
      aspect_ratio: "16:9",
      reference_order: input.referenceImages.map((r, i) => ({ index: i + 1, role: r.role })),
      visible_anchor_ids: anchors.map((a) => a.id),
      hidden_anchor_ids: [],
    },
    location_summary: truncate(
      `${location.name}: ${what}, ${materials ?? "plaster, wood and stone"}, ${light ?? "soft daylight"}.`,
      200,
    )
      .split(/\s+/)
      .slice(0, 38)
      .join(" "),
    assumptions,
    warnings,
    style_used: style,
    style_source: input.styleOverride ? "style_override" : "project_style",
    applied_fixes: [],
  };
}

export function sampleLocationGenerator(raw: unknown): LocationGeneratorOutput {
  const input = locationGeneratorInputSchema.parse(raw);
  if (!isLocationFix(input)) return fresh(input);
  const previous = locationGeneratorOutputSchema.safeParse(input.previousOutput);
  const base = previous.success ? previous.data : fresh(input);
  const additions = [
    ...input.fixRequests.map((f) =>
      f.customText ? `${f.instruction} (${f.customText})` : f.instruction,
    ),
    ...(input.userNotes ? [`Director's note: ${input.userNotes}`] : []),
  ];
  const heroRef = input.referenceImages.some((r) => r.role === "hero");
  // A rejected uploaded Hero is restyled with the fixes on top; without the photo it is drawn.
  const heroMode = !heroRef
    ? "generate"
    : base.hero_wide.mode === "use_uploaded"
      ? "restyle_uploaded"
      : base.hero_wide.mode;
  const prompt =
    base.hero_wide.image_prompt ||
    (heroMode === "generate"
      ? fresh({ ...input, referenceImages: [] }).hero_wide.image_prompt
      : "Keep the architecture, layout and composition of the first reference image exactly and re-render it in the project style.");
  return {
    ...base,
    hero_wide: {
      ...base.hero_wide,
      mode: heroMode,
      image_prompt: truncate(`${prompt.replace(/[.\s]+$/, "")}. ${additions.join(" ")}`, 6000),
      reference_order: input.referenceImages.map((r, i) => ({ index: i + 1, role: r.role })),
    },
    style_source: input.styleOverride ? "style_override" : "project_style",
    assumptions: input.fixRequests.some((f) => f.code === "LP07")
      ? [
          ...base.assumptions,
          "The layout was redesigned as the note asks; DNA and coverage follow it.",
        ]
      : base.assumptions,
    warnings: [],
    applied_fixes: input.fixRequests.map((f) => f.code),
  };
}
