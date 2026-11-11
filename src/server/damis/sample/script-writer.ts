/**
 * Sample script-writer: a short, properly formatted screenplay built from the brief and style.
 * Title from the brief, 3 to 5 scenes (per episode for a series), 2 to 3 named characters, a few
 * locations and props, padded to roughly the duration's word target.
 */
import { scriptWriterInputSchema, type ScriptWriterOutput } from "../script-writer/schema";
import { formatSeconds, planDuration } from "../shared/style";
import { countWords, Seeded, titleCase, truncate } from "./util";

type Place = { name: string; interior: boolean };
type Character = { cue: string; intro: string };

const STOPWORDS = new Set(
  "a an and the of in on at to for with from into about after before over under when where while who what which that this these those is are was were be been his her their its our your my one two who whom".split(
    " ",
  ),
);

const NAME_POOL = [
  "MARA",
  "JONAS",
  "ELIF",
  "TEO",
  "NADIA",
  "OWEN",
  "SANA",
  "RAFI",
  "LENA",
  "KAVEH",
  "IRIS",
  "MILO",
  "YARA",
  "DARIUS",
  "NOOR",
  "FELIX",
];

const INTROS = [
  "(30s), wiry and restless, a frayed canvas jacket",
  "(60s), broad-shouldered, flat cap, slow careful hands",
  "(20s), sharp-eyed, ink-stained fingers, hair tied back",
  "(40s), tall, rain-dark coat, a voice used to giving orders",
  "(teens), small for their age, oversized sneakers, quick grin",
  "(50s), silver-rimmed glasses, cardigan buttoned wrong",
];

const PLACE_SETS: Array<{ match: RegExp; places: Place[] }> = [
  {
    match: /sea|ocean|harbou?r|ship|boat|island|beach|lighthouse|fisher/i,
    places: [
      { name: "HARBOUR PIER", interior: false },
      { name: "LIGHTHOUSE GALLERY", interior: true },
      { name: "FERRY CABIN", interior: true },
    ],
  },
  {
    match: /space|planet|star|orbit|alien|mars|moon|rocket/i,
    places: [
      { name: "STARSHIP BRIDGE", interior: true },
      { name: "CARGO BAY", interior: true },
      { name: "CRATER RIDGE", interior: false },
    ],
  },
  {
    match: /forest|wood|tree|mountain|village|wolf|cabin/i,
    places: [
      { name: "PINE FOREST", interior: false },
      { name: "WOODCUTTER'S CABIN", interior: true },
      { name: "MOUNTAIN PASS", interior: false },
    ],
  },
  {
    match: /desert|sand|dune|oasis/i,
    places: [
      { name: "DUNE CREST", interior: false },
      { name: "ROADSIDE MOTEL", interior: true },
      { name: "DRY RIVERBED", interior: false },
    ],
  },
  {
    match: /school|class|teacher|student|exam/i,
    places: [
      { name: "SCHOOL CORRIDOR", interior: true },
      { name: "EMPTY CLASSROOM", interior: true },
      { name: "SCHOOL ROOFTOP", interior: false },
    ],
  },
  {
    match: /train|station|railway|platform/i,
    places: [
      { name: "STATION PLATFORM", interior: false },
      { name: "NIGHT TRAIN CARRIAGE", interior: true },
      { name: "SIGNAL BOX", interior: true },
    ],
  },
  {
    match: /hospital|doctor|nurse|clinic/i,
    places: [
      { name: "HOSPITAL CORRIDOR", interior: true },
      { name: "WAITING ROOM", interior: true },
      { name: "AMBULANCE BAY", interior: false },
    ],
  },
  {
    match: /house|home|family|kitchen|mother|father|sister|brother|grand/i,
    places: [
      { name: "FAMILY KITCHEN", interior: true },
      { name: "BACK GARDEN", interior: false },
      { name: "ATTIC", interior: true },
    ],
  },
];

const DEFAULT_PLACES: Place[] = [
  { name: "CITY ROOFTOP", interior: false },
  { name: "CORNER CAFE", interior: true },
  { name: "APARTMENT HALLWAY", interior: true },
  { name: "OLD BOOKSHOP", interior: true },
];

/** Every prop here is also in the sample asset detector's lexicon. */
const PROP_POOL = [
  "brass locket",
  "folded letter",
  "old radio",
  "paper map",
  "silver key",
  "lantern",
  "photograph",
  "compass",
  "notebook",
  "umbrella",
];

const TIMES = ["DAY", "NIGHT", "DUSK", "DAWN"];

const LIGHT = [
  "Cold blue light leaks through every gap.",
  "A single warm lamp throws long shadows.",
  "Low sun turns the dust gold.",
  "Rain streaks the air silver under a flickering light.",
];

type Cast = { a: Character; b: Character; c: Character | null };
type Ctx = { cast: Cast; props: string[]; rng: Seeded };

function nameOf(c: Character): string {
  return titleCase(c.cue);
}

function heading(place: Place, time: string): string {
  return `${place.interior ? "INT." : "EXT."} ${place.name} - ${time}`;
}

function exchange(speaker: Character, line: string, other: Character, reply: string): string[] {
  return [speaker.cue, line, "", other.cue, reply, ""];
}

function openingScene(ctx: Ctx, place: Place, time: string): string[] {
  const { a } = ctx.cast;
  const prop = ctx.props[0] ?? "notebook";
  return [
    heading(place, time),
    "",
    `${titleCase(place.name)}. ${ctx.rng.pick(LIGHT)}`,
    "",
    `${a.cue} ${a.intro}, turns the ${prop} over in both hands, as if it might answer.`,
    "",
    a.cue,
    "(quietly)",
    "Not today. Not after all this.",
    "",
  ];
}

function meetingScene(ctx: Ctx, place: Place, time: string): string[] {
  const { a, b } = ctx.cast;
  const prop = ctx.props[1] ?? ctx.props[0] ?? "lantern";
  return [
    heading(place, time),
    "",
    `${b.cue} ${b.intro}, waits by the door. A ${prop} sits on the table between two cups.`,
    "",
    `${nameOf(a)} enters and stops short.`,
    "",
    ...exchange(
      b,
      `You came. I wasn't sure you would.`,
      a,
      `You left me the ${prop}. That's not a question.`,
    ),
  ];
}

function turnScene(ctx: Ctx, place: Place, time: string): string[] {
  const { a, b, c } = ctx.cast;
  const third = c ?? b;
  const prop = ctx.props[0] ?? "notebook";
  const lines = [
    heading(place, time),
    "",
    `Wind. Footsteps. ${nameOf(a)} and ${nameOf(b)} move fast, the ${prop} held tight.`,
    "",
  ];
  if (c) lines.push(`${c.cue} ${c.intro}, steps out of the dark and blocks the way.`, "");
  lines.push(...exchange(third, "Give it to me and nobody gets hurt.", a, "It was never yours."));
  return lines;
}

function endingScene(ctx: Ctx, place: Place, time: string): string[] {
  const { a, b } = ctx.cast;
  const prop = ctx.props[0] ?? "notebook";
  return [
    heading(place, time),
    "",
    `Quiet again. ${nameOf(a)} opens the ${prop}. Inside, something small and bright.`,
    "",
    `${nameOf(b)} watches ${nameOf(a)}'s face change.`,
    "",
    ...exchange(b, "Was it worth it?", a, "Ask me tomorrow."),
    `${nameOf(a)} smiles, closes it, and walks into the light.`,
    "",
  ];
}

/** Extra beats appended to scenes to reach the duration's word target. ~35 words each. */
function paddingBeat(ctx: Ctx, n: number): string[] {
  const { a, b } = ctx.cast;
  const prop = ctx.props[n % Math.max(1, ctx.props.length)] ?? "notebook";
  const beats: string[][] = [
    [
      `${nameOf(a)} crosses to the window. Outside, the light fades one patch at a time.`,
      "",
      ...exchange(
        b,
        "You keep looking out there.",
        a,
        "Because something out there keeps looking back.",
      ),
    ],
    [
      `${nameOf(b)} sets the ${prop} down, slow and deliberate, and slides it across.`,
      "",
      ...exchange(a, "Why now?", b, "Because later stopped being an option."),
    ],
    [
      `A long silence. A clock ticks somewhere. ${nameOf(a)} counts without a sound.`,
      "",
      ...exchange(b, "What are you counting?", a, "How many chances we have left."),
    ],
    [
      `${nameOf(a)} unfolds the ${prop}, studies it, then folds it again along the same creases.`,
      "",
      ...exchange(b, "You've read it a hundred times.", a, "And it still says the same thing."),
    ],
    [
      `Somewhere close, a door bangs in the wind. Both of them freeze.`,
      "",
      ...exchange(a, "Did you hear that?", b, "Don't move. Let it pass."),
    ],
    [
      `${nameOf(b)} laughs, short and surprised, and for a moment looks years younger.`,
      "",
      ...exchange(a, "I forgot you could do that.", b, "So did I."),
    ],
    [
      `${nameOf(a)} pockets the ${prop}, then takes it out again, as if it weighs more than it should.`,
      "",
      ...exchange(b, "Put it away or use it.", a, "I'm deciding."),
    ],
    [
      `The light dips. In the half-dark, ${nameOf(b)} finally says what has been waiting all night.`,
      "",
      ...exchange(b, "I should have told you sooner.", a, "You're telling me now."),
    ],
  ];
  return beats[n % beats.length] ?? [];
}

function namesFromBrief(brief: string): string[] {
  const names: string[] = [];
  const sentences = brief.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).slice(1); // skip the sentence-initial capital
    for (const raw of words) {
      const word = raw.replace(/[^A-Za-z'-]/g, "");
      if (/^[A-Z][a-z]{2,}$/.test(word) && !STOPWORDS.has(word.toLowerCase())) {
        const cue = word.toUpperCase();
        if (!names.includes(cue)) names.push(cue);
      }
    }
  }
  return names.slice(0, 2);
}

function titleFromBrief(brief: string): string {
  const first = (brief.split(/[.!?\n]/)[0] ?? brief).trim() || brief.trim();
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length <= 4)
    return truncate(titleCase(first.replace(/[.,;:!?]+$/, "")), 120) || "Untitled";
  const candidates = words
    .map((w) => w.replace(/[.,;:!?"'()]+/g, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
  const longest = candidates.reduce((best, w) => (w.length > best.length ? w : best), "");
  if (!longest) return truncate(first, 60);
  return /[A-Za-z]/.test(longest) ? `The ${titleCase(longest)}` : longest;
}

function propsFromBrief(brief: string, rng: Seeded, count: number): string[] {
  const lower = brief.toLowerCase();
  const mentioned = PROP_POOL.filter((p) => lower.includes(p.split(" ").at(-1) ?? p));
  const rest = rng.sample(
    PROP_POOL.filter((p) => !mentioned.includes(p)),
    PROP_POOL.length,
  );
  return [...mentioned, ...rest].slice(0, count);
}

function writeEpisode(
  ctx: Ctx,
  places: Place[],
  sceneCount: number,
  targetWords: number,
): string[] {
  const scenes: string[][] = [];
  for (let i = 0; i < sceneCount; i++) {
    const place = places[i % places.length] as Place;
    const time = i === sceneCount - 1 ? "DAWN" : ctx.rng.pick(TIMES);
    if (i === 0) scenes.push(openingScene(ctx, place, time));
    else if (i === sceneCount - 1) scenes.push(endingScene(ctx, places[0] as Place, time));
    else if (i === 1) scenes.push(meetingScene(ctx, place, time));
    else scenes.push(turnScene(ctx, place, time));
  }
  let words = scenes.reduce((n, s) => n + countWords(s.join(" ")), 0);
  // Pad the middle scenes (never the opening or the ending) until roughly 80% of the target.
  const middle = Math.max(1, sceneCount - 2);
  for (let n = 0; words < targetWords * 0.8; n++) {
    const beat = paddingBeat(ctx, n);
    scenes[1 + (n % middle)]?.push(...beat);
    words += countWords(beat.join(" "));
  }
  return scenes.flat();
}

export function sampleScriptWriter(raw: unknown): ScriptWriterOutput {
  const input = scriptWriterInputSchema.parse(raw);
  const { style, brief } = input;
  const rng = new Seeded(JSON.stringify(input));
  const plan = planDuration(style);

  const fromBrief = namesFromBrief(brief);
  const castSize = rng.int(2, 3);
  const pool = rng.sample(
    NAME_POOL.filter((n) => !fromBrief.includes(n)),
    castSize,
  );
  const cues = [...fromBrief, ...pool].slice(0, castSize);
  const intros = rng.sample(INTROS, castSize);
  const characters: Character[] = cues.map((cue, i) => ({ cue, intro: intros[i] ?? "" }));
  const cast: Cast = {
    a: characters[0] as Character,
    b: characters[1] as Character,
    c: characters[2] ?? null,
  };
  const props = propsFromBrief(brief, rng, rng.int(2, 3));
  const set = PLACE_SETS.find((s) => s.match.test(brief))?.places ?? DEFAULT_PLACES;
  const ctx: Ctx = { cast, props, rng };

  const seconds = plan.episodeSeconds ?? plan.totalSeconds;
  const sceneCount = 3 + (seconds >= 120 ? 1 : 0) + (seconds >= 240 ? 1 : 0);
  const places = rng.sample(set, Math.min(set.length, Math.max(2, sceneCount - 1)));

  const lines: string[] = ["FADE IN:", ""];
  if (plan.episodes !== null) {
    for (let e = 1; e <= plan.episodes; e++) {
      lines.push(`EPISODE ${e}: ${e === 1 ? "THE FIRST SIGN" : `CHAPTER ${e}`}`, "");
      lines.push(...writeEpisode(ctx, places, sceneCount, plan.targetWordsPerEpisode ?? 0));
    }
  } else {
    lines.push(...writeEpisode(ctx, places, sceneCount, plan.targetWords));
  }
  lines.push("FADE OUT.");
  const content = lines.join("\n");

  const names = characters.map(nameOf);
  const title = titleFromBrief(brief);
  return {
    title,
    logline: truncate(
      `${names[0]} and ${names[1]} must decide what the ${props[0]} is worth before the night takes the choice away (from the brief: “${truncate(brief, 140)}”).`,
      400,
    ),
    content,
    notes: [
      "Sample mode: this script was assembled from templates seeded by your brief, not written by Claude. Add an Anthropic API key for a real script.",
      `Sized to about ${formatSeconds(plan.totalSeconds)} of screen time (${countWords(content)} words).`,
      truncate(
        `Placeholder cast and places: ${names.join(", ")}; ${places.map((p) => titleCase(p.name)).join(", ")}.`,
        400,
      ),
    ],
  };
}
