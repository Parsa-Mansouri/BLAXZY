/**
 * Sample Script Writer v0.2: structured screenplays and outlines built from the input, sized with
 * the owner's runtime estimate so they land inside the tolerance. Deterministic for a given input.
 */
import {
  estimate,
  SECONDS_PER_ACTION_BEAT,
  DIALOGUE_WORDS_PER_SECOND,
  countWords,
} from "../shared/duration";
import {
  scriptOutlineInputSchema,
  scriptWriterInputSchema,
  type ContinuityLedger,
  type ScreenplayElement,
  type ScreenplayScene,
  type SubmitOutline,
  type SubmitScreenplay,
} from "../script-writer/schema";
import { Seeded, titleCase, truncate } from "./util";

type Place = { name: string; int_ext: "INT" | "EXT" | "INT/EXT" };
type Person = { name: string; intro: string };

const STOPWORDS = new Set(
  "a an and the of in on at to for with from into about after before over under when where while who what which that this these those is are was were be been his her their its our your my one two whom then there they she he it".split(
    " ",
  ),
);

const NAME_POOL = ["Mara", "Jonas", "Elif", "Teo", "Nadia", "Owen", "Sana", "Rafi", "Lena", "Iris"];
const INTROS = [
  "(30s), wiry and restless, a frayed canvas jacket",
  "(60s), broad-shouldered, flat cap, slow careful hands",
  "(20s), sharp-eyed, ink-stained fingers, hair tied back",
  "(40s), tall, rain-dark coat",
  "(teens), small for their age, oversized sneakers",
];
const PLACE_SETS: Array<{ match: RegExp; places: Place[] }> = [
  {
    match: /sea|ocean|harbou?r|ship|boat|island|beach|lighthouse|fisher|ferry/i,
    places: [
      { name: "Harbour Pier", int_ext: "EXT" },
      { name: "Lighthouse Gallery", int_ext: "INT" },
      { name: "Ferry Cabin", int_ext: "INT" },
    ],
  },
  {
    match: /space|planet|star|orbit|alien|mars|moon|rocket/i,
    places: [
      { name: "Starship Bridge", int_ext: "INT" },
      { name: "Cargo Bay", int_ext: "INT" },
      { name: "Crater Ridge", int_ext: "EXT" },
    ],
  },
  {
    match: /forest|wood|tree|mountain|village|wolf|cabin|bear/i,
    places: [
      { name: "Pine Forest", int_ext: "EXT" },
      { name: "Woodcutter's Cabin", int_ext: "INT" },
      { name: "Mountain Pass", int_ext: "EXT" },
    ],
  },
  {
    match: /house|home|family|kitchen|mother|father|sister|brother|grand/i,
    places: [
      { name: "Family Kitchen", int_ext: "INT" },
      { name: "Back Garden", int_ext: "EXT" },
      { name: "Attic", int_ext: "INT" },
    ],
  },
];
const DEFAULT_PLACES: Place[] = [
  { name: "City Rooftop", int_ext: "EXT" },
  { name: "Corner Cafe", int_ext: "INT" },
  { name: "Apartment Hallway", int_ext: "INT" },
];
const PROP_POOL = [
  "brass locket",
  "folded letter",
  "old radio",
  "paper map",
  "silver key",
  "lantern",
];
const TIMES = ["DAY", "NIGHT", "DUSK", "DAWN"] as const;

const ACTIONS = [
  (a: string, p: string) => `${a} turns the ${p} over in both hands.`,
  (a: string, p: string) => `${a} sets the ${p} down on the table, slow and deliberate.`,
  (a: string) => `${a} crosses to the window and waits.`,
  (a: string, p: string) => `${a} pockets the ${p}, then takes it out again.`,
  (a: string) => `A door bangs somewhere close. ${a} freezes.`,
  (a: string) => `${a} counts under their breath, eyes on the floor.`,
];
const LINES = [
  "You came. I wasn't sure you would.",
  "Not today. Not after all this.",
  "Put it away or use it.",
  "Ask me again tomorrow.",
  "You kept it all this time?",
  "Then we do it my way.",
  "I should have told you sooner.",
  "Listen. Do you hear that?",
];

function namesFromStory(story: string): string[] {
  const names: string[] = [];
  for (const sentence of story.split(/(?<=[.!?])\s+|\n+/)) {
    for (const raw of sentence.split(/\s+/).slice(1)) {
      const word = raw.replace(/[^A-Za-z'-]/g, "");
      if (/^[A-Z][a-z]{2,}$/.test(word) && !STOPWORDS.has(word.toLowerCase())) {
        if (!names.includes(word)) names.push(word);
      }
    }
  }
  return names.slice(0, 3);
}

function titleFrom(story: string): string {
  const first = (story.split(/[.!?\n]/)[0] ?? story).trim();
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length <= 4)
    return truncate(titleCase(first.replace(/[.,;:!?]+$/, "")), 80) || "Untitled";
  const longest = words
    .map((w) => w.replace(/[.,;:!?"'()]+/g, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()))
    .reduce((best, w) => (w.length > best.length ? w : best), "");
  if (!longest) return truncate(first, 60);
  return /[A-Za-z]/.test(longest) ? `The ${titleCase(longest)}` : longest;
}

function languageOf(text: string): string {
  return /[؀-ۿ]/.test(text) ? "fa" : "en";
}

type World = { people: Person[]; places: Place[]; props: string[]; rng: Seeded };

function worldFor(story: string, seed: string): World {
  const rng = new Seeded(seed);
  const fromStory = namesFromStory(story);
  const pool = rng.sample(
    NAME_POOL.filter((n) => !fromStory.includes(n)),
    3,
  );
  const names = [...fromStory, ...pool].slice(0, Math.max(2, Math.min(3, fromStory.length || 2)));
  const intros = rng.sample(INTROS, names.length);
  const lower = story.toLowerCase();
  const mentioned = PROP_POOL.filter((p) => lower.includes(p.split(" ").at(-1) ?? p));
  const props = [
    ...mentioned,
    ...rng.sample(
      PROP_POOL.filter((p) => !mentioned.includes(p)),
      6,
    ),
  ].slice(0, 2);
  const places = PLACE_SETS.find((s) => s.match.test(story))?.places ?? DEFAULT_PLACES;
  return {
    people: names.map((name, i) => ({ name, intro: intros[i] ?? "" })),
    places,
    props,
    rng,
  };
}

const sceneSeconds = (elements: ScreenplayElement[]) =>
  estimate({ scenes: [{ elements }] }).seconds;

/** A scene filled with alternating action and dialogue until it reaches `target` seconds. */
function buildScene(
  world: World,
  number: number,
  target: number,
  introduced: Set<string>,
  place: Place,
  time: ScreenplayScene["heading"]["time_of_day"],
  isLast: boolean,
): ScreenplayScene {
  const { people, props, rng } = world;
  const elements: ScreenplayElement[] = [];
  const prop = props[number % Math.max(1, props.length)] ?? "lantern";
  const [a, b] = [
    people[number % people.length] as Person,
    people[(number + 1) % people.length] as Person,
  ];
  const mention = (p: Person) => {
    if (introduced.has(p.name)) return p.name;
    introduced.add(p.name);
    return `${p.name.toUpperCase()} ${p.intro},`;
  };
  elements.push({
    type: "action",
    text: `${mention(a)} waits in the ${place.name.toLowerCase()}.`,
  });
  let n = 0;
  // The closing image (two beats) is added after the loop, so the last scene leaves room for it.
  const budget = isLast ? target - 2 * SECONDS_PER_ACTION_BEAT : target;
  while (sceneSeconds(elements) < budget - 1) {
    const remaining = budget - sceneSeconds(elements);
    if (n % 2 === 0 && remaining >= SECONDS_PER_ACTION_BEAT) {
      const actor = n % 4 === 0 ? b : a;
      const who = introduced.has(actor.name) ? actor.name : mention(actor);
      elements.push({ type: "action", text: rng.pick(ACTIONS)(who, prop) });
    } else {
      const speaker = n % 4 === 1 ? b : a;
      if (!introduced.has(speaker.name)) {
        elements.push({ type: "action", text: `${mention(speaker)} steps closer.` });
      }
      let line = rng.pick(LINES);
      // Short remainders get short lines.
      const words = Math.max(1, Math.floor(remaining * DIALOGUE_WORDS_PER_SECOND));
      if (countWords(line) > words) line = line.split(/\s+/).slice(0, words).join(" ");
      elements.push({ type: "dialogue", character: speaker.name, text: line });
    }
    n++;
    if (n > 400) break;
  }
  if (isLast)
    elements.push({
      type: "action",
      text: `${mention(b)} watches ${a.name} open the ${prop}. Inside, something small and bright.`,
    });
  const seconds = Math.max(1, sceneSeconds(elements));
  return {
    scene_number: number,
    heading: { int_ext: place.int_ext, location: place.name, time_of_day: time },
    purpose: isLast ? `Resolve what the ${prop} means.` : `Raise the stakes around the ${prop}.`,
    change: isLast ? "The choice is made." : `${a.name} trusts ${b.name} a little less.`,
    elements,
    estimated_seconds: seconds,
  };
}

function sceneCountFor(seconds: number): number {
  if (seconds <= 30) return 1;
  if (seconds <= 90) return 2;
  if (seconds <= 300) return Math.min(6, Math.max(2, Math.round(seconds / 60)));
  return Math.min(15, Math.max(5, Math.round(seconds / 75)));
}

function finish(
  title: string,
  logline: string,
  language: string,
  scenes: ScreenplayScene[],
  world: World,
  extra: Partial<SubmitScreenplay> = {},
): SubmitScreenplay {
  const total = scenes.reduce((s, sc) => s + sc.estimated_seconds, 0);
  const names = world.people.map((p) => p.name);
  return {
    story_parse: {
      characters: world.people.map((p, i) => ({
        name: p.name,
        role: i === 0 ? "protagonist" : "supporting",
        want: `to keep the ${world.props[0] ?? "secret"} safe`,
      })),
      central_action: `${names[0]} decides what the ${world.props[0] ?? "secret"} is worth.`,
      fixed_events: [],
      desired_ending: "As the story states, or open.",
      unknowns: ["The characters' ages are not stated."],
    },
    beats: [
      {
        id: "b1",
        type: "opening_state",
        summary: "The situation at rest.",
        genre_effect: "Sets the tone.",
        style_effect: "Establishes the world.",
      },
      {
        id: "b2",
        type: "turn",
        summary: "The turn.",
        genre_effect: "Raises pressure.",
        style_effect: "Changes what we see.",
      },
      {
        id: "b3",
        type: "ending",
        summary: "The ending image.",
        genre_effect: "Pays off.",
        style_effect: "Closes on a clear image.",
      },
    ],
    screenplay: { title, logline, language, estimated_duration_seconds: total, scenes },
    added_assumptions: [
      {
        text: `The ${world.props[0] ?? "object"} is the object at the centre of the story.`,
        reason: "The story did not name a specific object.",
        scene_number: scenes[0]?.scene_number ?? 1,
      },
      ...world.people
        .filter((p) => !p.intro.startsWith("("))
        .map((p) => ({ text: `${p.name} is ${p.intro}.`, reason: "Not stated.", scene_number: 1 })),
    ],
    validation: {
      premise_preserved: true,
      every_scene_has_goal_and_change: true,
      cause_and_effect_clear: true,
      genre_effect_traceable: true,
      style_effect_traceable: true,
      genre_and_style_kept_separate: true,
      all_action_visible_or_audible: true,
      names_and_props_consistent: true,
      elements_valid: true,
      no_production_directives: true,
      within_duration_budget: true,
      notes: "Sample output: assembled from templates, not written by Claude.",
    },
    warnings: [
      "Sample mode: this script was assembled from templates seeded by your story, not written by Claude.",
    ],
    ...extra,
  };
}

function generate(story: string, target: number, seed: string): SubmitScreenplay {
  const world = worldFor(story, seed);
  const count = sceneCountFor(target);
  const per = (target - 0) / count;
  const introduced = new Set<string>();
  const scenes: ScreenplayScene[] = [];
  for (let i = 0; i < count; i++) {
    const place = world.places[i % world.places.length] as Place;
    const time = i === count - 1 ? "DAWN" : world.rng.pick(TIMES);
    scenes.push(
      buildScene(world, i + 1, Math.round(per), introduced, place, time, i === count - 1),
    );
  }
  const names = world.people.map((p) => p.name);
  return finish(
    titleFrom(story),
    truncate(
      `${names[0]} and ${names[1]} must decide what the ${world.props[0]} is worth before the night decides for them.`,
      300,
    ),
    languageOf(story),
    scenes,
    world,
  );
}

function trimScene(scene: ScreenplayScene, seconds: number): ScreenplayScene {
  const elements = [...scene.elements];
  while (elements.length > 1 && sceneSeconds(elements) > seconds) {
    const i = elements.findLastIndex((e, j) => j > 0);
    elements.splice(i, 1);
  }
  return { ...scene, elements, estimated_seconds: Math.max(1, sceneSeconds(elements)) };
}

export function sampleScriptWriter(raw: unknown): SubmitScreenplay {
  const input = scriptWriterInputSchema.parse(raw);
  const seed = JSON.stringify(input);
  const target = input.project.targetDurationSeconds;

  if (input.mode === "generate") return generate(input.story, target, seed);

  if (input.mode === "write_segment") {
    const outline = input.approvedOutline;
    const sequence = outline.acts.flatMap((a) => a.sequences).find((s) => s.id === input.segmentId);
    const story = `${outline.logline} ${outline.canonical_names.characters.join(" ")}`;
    const world = worldFor(story, seed);
    world.people = outline.canonical_names.characters.slice(0, 3).map((name, i) => ({
      name,
      intro: INTROS[i % INTROS.length] ?? "",
    }));
    if (world.people.length < 2) world.people.push({ name: "Jonas", intro: INTROS[1] ?? "" });
    const introduced = new Set(input.continuityLedger?.introduced_characters ?? []);
    const isFinal = outline.acts.flatMap((a) => a.sequences).at(-1)?.id === input.segmentId;
    const scenes = (sequence?.scenes ?? []).map((s, i, all) =>
      buildScene(
        world,
        s.scene_number,
        s.target_seconds,
        introduced,
        { name: s.location, int_ext: s.int_ext },
        s.time_of_day,
        isFinal && i === all.length - 1,
      ),
    );
    const ledger: ContinuityLedger = {
      introduced_characters: [...introduced],
      character_states: world.people.map((p) => ({
        name: p.name,
        location: scenes.at(-1)?.heading.location ?? "",
        visible_state: "as introduced",
      })),
      prop_states: world.props.map((p) => ({
        name: p,
        location_or_holder: world.people[0]?.name ?? "",
        state: "intact",
      })),
      open_threads: isFinal ? [] : ["What the object means."],
    };
    return finish(
      sequence?.summary ?? outline.logline,
      outline.logline,
      outline.language ?? "en",
      scenes,
      world,
      {
        segment_id: input.segmentId,
        continuity_ledger: ledger,
      },
    );
  }

  // revise: copy every scene; change only the scoped ones, and fit the runtime when asked.
  const previous = input.previousScreenplay;
  const world = worldFor(`${previous.logline} ${previous.title}`, seed);
  const reasons = input.feedback.selectedReasons;
  const scope = new Set(input.feedback.scope ?? []);
  const changeLog: NonNullable<SubmitScreenplay["change_log"]> = [];
  let scenes: ScreenplayScene[] = previous.scenes.map((s) => ({ ...s, elements: [...s.elements] }));
  const note = input.feedback.customNote;
  const targets = scenes.filter((s) => scope.size === 0 || scope.has(s.scene_number));
  const first = targets[0] ?? scenes[0];
  if (first && (note || reasons.some((r) => r !== "too_long" && r !== "too_short"))) {
    const addition: ScreenplayElement = {
      type: "action",
      text: "A beat of stillness. Everyone in the room waits to see who moves first.",
    };
    scenes = scenes.map((s) =>
      s.scene_number === first.scene_number
        ? {
            ...s,
            elements: [...s.elements, addition],
            estimated_seconds: s.estimated_seconds + SECONDS_PER_ACTION_BEAT,
          }
        : s,
    );
    changeLog.push({
      scene_number: first.scene_number,
      change: "Added a held beat of stillness.",
      addresses: truncate(note ?? reasons.join(", "), 200),
    });
  }
  const now = estimate({ scenes }).seconds;
  if (now > target + 5 || reasons.includes("too_long")) {
    const factor = Math.min(1, target / Math.max(1, now));
    scenes = scenes.map((s) => trimScene(s, Math.max(4, Math.floor(s.estimated_seconds * factor))));
    changeLog.push({
      scene_number: scenes[0]?.scene_number ?? 1,
      change: "Tightened scenes to fit the runtime.",
      addresses: "too_long",
    });
  } else if (now < target - 5 || reasons.includes("too_short")) {
    const last = scenes.at(-1);
    if (last) {
      const extra = Math.max(SECONDS_PER_ACTION_BEAT, target - now);
      const grown = buildScene(
        world,
        last.scene_number,
        last.estimated_seconds + extra,
        new Set(world.people.map((p) => p.name)),
        { name: last.heading.location, int_ext: last.heading.int_ext },
        last.heading.time_of_day,
        false,
      );
      scenes = [
        ...scenes.slice(0, -1),
        {
          ...last,
          elements: [...last.elements, ...grown.elements.slice(1)],
          estimated_seconds: last.estimated_seconds + grown.estimated_seconds,
        },
      ];
      changeLog.push({
        scene_number: last.scene_number,
        change: "Deepened the final scene.",
        addresses: "too_short",
      });
    }
  }
  scenes = scenes.map((s) => ({ ...s, estimated_seconds: Math.max(1, sceneSeconds(s.elements)) }));
  if (changeLog.length === 0) {
    changeLog.push({
      scene_number: scenes[0]?.scene_number ?? 1,
      change: "No change needed.",
      addresses: "feedback",
    });
  }
  return finish(previous.title, previous.logline, previous.language, scenes, world, {
    change_log: changeLog,
  });
}

/** Splits `total` into `parts` integers that add up to it. */
function split(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, i) => base + (i < total - base * parts ? 1 : 0));
}

export function sampleScriptOutline(raw: unknown): SubmitOutline {
  const input = scriptOutlineInputSchema.parse(raw);
  const world = worldFor(input.story, JSON.stringify(input));
  const target = input.project.targetDurationSeconds;
  const quarter = Math.round(target * 0.25);
  const actTargets = [quarter, target - 2 * quarter, quarter];
  let sceneNumber = 1;
  let seq = 1;
  const purposes = ["Setup", "Confrontation", "Resolution"];
  const acts = actTargets.map((actTarget, a) => ({
    act: a + 1,
    purpose: purposes[a] ?? "",
    target_seconds: actTarget,
    sequences: split(actTarget, Math.max(1, Math.ceil(actTarget / 480))).map((seqTarget) => {
      const id = `S${seq++}`;
      return {
        id,
        summary: `${world.people[0]?.name ?? "The hero"} faces part ${id} of the story.`,
        target_seconds: seqTarget,
        scenes: split(seqTarget, Math.max(1, Math.round(seqTarget / 90))).map((t, i) => {
          const place = world.places[(sceneNumber + i) % world.places.length] as Place;
          return {
            scene_number: sceneNumber++,
            int_ext: place.int_ext,
            location: place.name,
            time_of_day: TIMES[sceneNumber % TIMES.length] ?? "DAY",
            characters: world.people.slice(0, 2).map((p) => p.name),
            key_props: world.props.slice(0, 1),
            purpose: "Move the story one step.",
            change: "Something is different at the end.",
            target_seconds: t,
          };
        }),
      };
    }),
  }));
  return {
    logline: truncate(
      `${world.people[0]?.name} must decide what the ${world.props[0]} is worth.`,
      300,
    ),
    language: languageOf(input.story),
    canonical_names: {
      characters: world.people.map((p) => p.name),
      locations: world.places.map((p) => p.name),
      props: world.props,
    },
    acts,
    proposed_additions: [
      {
        text: `A neighbour who has seen the ${world.props[0]} before.`,
        reason: "The story is short for this runtime.",
        scene_numbers: [Math.min(3, sceneNumber - 1)],
      },
    ],
    warnings: input.feedback ? [`Reworked from your notes: ${truncate(input.feedback, 160)}`] : [],
  };
}
