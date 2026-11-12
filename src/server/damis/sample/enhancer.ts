/**
 * Sample enhancer: keeps every paragraph of the user's prompt in order and adds a short
 * genre-flavoured performance sentence and a short look sentence to each, from small phrase
 * tables per owner genre and style. Adds no characters, objects or events; very short prompts are
 * filled to roughly 60-110 words with more of the same kind of sentence.
 */
import {
  enhancerInputSchema,
  type EnhancerOutput,
  type OwnerEnhancerGenre,
  type OwnerEnhancerStyle,
} from "../enhancer/schema";
import { collapseWhitespace, countWords, Seeded } from "./util";

const GENRE_PHRASES: Record<OwnerEnhancerGenre, readonly string[]> = {
  Drama: [
    "Every reaction is held back a little, so what goes unsaid weighs more than what is shown.",
    "After a beat of stillness, the emotional shift lands on one small, specific gesture.",
    "Glances linger a moment too long and an almost-made movement betrays what is felt.",
    "The pace stays unhurried, letting each beat breathe before the next one arrives.",
  ],
  Comedy: [
    "Everything is played with complete sincerity, and a clean beat comes before the payoff.",
    "After the turn, the reaction is held a beat too long, perfectly straight-faced.",
    "One clear comic action happens at a time, so the setup, turn and reaction read cleanly.",
    "The situation is taken entirely seriously, which is exactly what makes it funny.",
  ],
  Horror: [
    "Movement slows and breathing becomes controlled, as if something nearby must not notice.",
    "Less is shown than is feared; attention keeps drifting toward what stays out of sight.",
    "A long, quiet stillness stretches out before anything changes, tension building underneath.",
    "Hesitation shows in every step, each one more careful than the last.",
  ],
  Thriller: [
    "Pressure tightens a little with each beat, and every choice is made under visible risk.",
    "There is a deliberate pause, a quick calculation, then a sudden decisive shift.",
    "The answer is held back; what is known is never quite enough.",
    "A detail noticed early quietly matters by the end of the moment.",
  ],
  Action: [
    "Each movement is clear in direction, from where to where, and causes a visible consequence.",
    "The rhythm runs from build-up to impact to recovery, with momentum carried through.",
    "Positions stay readable at all times, with screen direction kept consistent.",
    "Every effort shows physical weight, and each beat leads cleanly into the next.",
  ],
  "Science Fiction": [
    "The world's single premise is treated as completely normal, never stopped to explain.",
    "The technology takes visible effort and has small consequences on behaviour.",
    "Cause and effect stay consistent with the premise, so every reaction follows its rules.",
    "Familiarity shows in how casually everything here is handled.",
  ],
};

const STYLE_PHRASES: Record<OwnerEnhancerStyle, readonly string[]> = {
  Realistic: [
    "Natural light from plausible sources falls off softly, with true-to-life textures and a controlled, natural grade.",
    "Surfaces show real wear and reflectivity, seen with a natural 35mm lens feel and gentle depth of field.",
    "Motivated window and practical light shape the space with realistic shadows and an unforced, natural palette.",
  ],
  Noir: [
    "Hard, directional low-key light carves deep shadows across the scene in a restrained, desaturated palette.",
    "Strong diagonals and generous negative space give the composition a geometric, high-contrast edge.",
    "Shadows from existing doorways and structures cut the frame into sharp shapes, with selective muted accents.",
  ],
  Futuristic: [
    "Clean engineered forms and seamless surfaces carry integrated lighting built into the structures.",
    "Composites, glass and brushed metal follow one coherent, advanced design language throughout.",
    "Existing objects read as designed hardware with smooth interfaces and precise, quiet lines.",
  ],
  "Horror Visual Style": [
    "Weak, low-key light leaves shadows swallowing the edges, in a muted palette with a cold, sallow cast.",
    "Generous negative space and foreground obstruction suggest depth that may hold something beyond view.",
    "Off-balance framing and dim, uneasy light keep part of the frame always obscured.",
  ],
  "3D Animation": [
    "Rounded, appealing forms and soft glossy materials sit under bright, coherent global illumination.",
    "A polished CGI render with clear key, fill and rim light and expressive, saturated colour.",
    "Stylized volumes with clean silhouettes and tactile shaders keep the look consistent and inviting.",
  ],
  Anime: [
    "Clean line art with varying line weight and cel-style flat shading over a painted, atmospheric background.",
    "Deliberate colour choices, strong silhouettes and a clear focal subject give the frame its anime clarity.",
    "Stylized highlights and dynamic perspective add restrained, purposeful exaggeration.",
  ],
  Claymation: [
    "Matte plasticine surfaces show fingerprints and tool marks on a handmade miniature set.",
    "Warm, soft practical-style light and a shallow depth of field give a tabletop-scale feel.",
    "A subtly stepped stop-motion cadence and the physical weight of clay give every movement texture.",
  ],
};

const LOOK_LINES: Record<OwnerEnhancerStyle, string> = {
  Realistic:
    "Photographic realism with natural motivated light, soft falloff, true-to-life textures, a natural lens feel and a controlled natural grade.",
  Noir: "Low-key, high-contrast look with hard directional light, deep shadows, a restrained desaturated palette and geometric composition with generous negative space.",
  Futuristic:
    "Coherent advanced design language with clean engineered forms, seamless composite and glass surfaces, and lighting integrated into the structures.",
  "Horror Visual Style":
    "Dread-inducing low-key look with weak motivated light, shadows swallowing the edges, a muted sallow palette and off-balance framing with generous negative space.",
  "3D Animation":
    "Stylized 3D animated look with rounded appealing forms, soft glossy materials, bright global-illumination lighting, saturated colour and a polished render.",
  Anime:
    "Anime look with clean varied line art, cel-style flat shading, deliberate colour, painted atmospheric backgrounds and strong silhouettes.",
  Claymation:
    "Handmade clay stop-motion look with matte fingerprinted plasticine, miniature sets, warm soft practical light and a shallow tabletop depth of field.",
};

/** Used to fill very short prompts when no genre or style is active. */
const NEUTRAL_PHRASES: readonly string[] = [
  "The action unfolds in a clear, simple order: first it is set up, then it plays out, and after a beat it settles.",
  "Every movement is deliberate and easy to follow, with the setting staying consistent throughout.",
  "The moment stays focused on what is already there, described plainly and concretely.",
  "Each beat follows from the one before it, so cause and effect stay readable from start to finish.",
  "Posture, pace and small pauses carry the feeling of the moment without any explanation.",
];

const SHORT_INPUT_WORDS = 40;
const SHORT_MIN_WORDS = 60;
const SHORT_MAX_WORDS = 110;

function sentence(text: string): string {
  const clean = collapseWhitespace(text);
  return /[.!?…؟。"'”»)]$/.test(clean) ? clean : `${clean}.`;
}

export function sampleEnhancer(raw: unknown): EnhancerOutput {
  const input = enhancerInputSchema.parse(raw);
  const rng = new Seeded(JSON.stringify(input));
  const { genre, visualStyle } = input;

  const paragraphs = input.userPrompt
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => [sentence(p)]);

  const genrePool = genre ? rng.sample(GENRE_PHRASES[genre], GENRE_PHRASES[genre].length) : [];
  const stylePool = visualStyle
    ? rng.sample(STYLE_PHRASES[visualStyle], STYLE_PHRASES[visualStyle].length)
    : [];
  paragraphs.forEach((p, i) => {
    const g = genrePool[i % Math.max(1, genrePool.length)];
    if (g) p.push(g);
    const s = stylePool[i % Math.max(1, stylePool.length)];
    if (s) p.push(s);
  });

  const words = () => paragraphs.reduce((n, p) => n + countWords(p.join(" ")), 0);
  const last = paragraphs.at(-1);
  if (last && countWords(input.userPrompt) < SHORT_INPUT_WORDS) {
    // Fill with the unused sentences of the active tables (neutral ones when none is active).
    const extra = [...genrePool.slice(paragraphs.length), ...stylePool.slice(paragraphs.length)];
    const fill = extra.length > 0 ? [...extra, ...NEUTRAL_PHRASES] : [...NEUTRAL_PHRASES];
    for (const phrase of fill) {
      if (words() >= SHORT_MIN_WORDS) break;
      if (words() + countWords(phrase) > SHORT_MAX_WORDS) break;
      last.push(phrase);
    }
  }

  return {
    status: "ok",
    enhanced_prompt: paragraphs.map((p) => p.join(" ")).join("\n\n"),
    look_line: visualStyle ? LOOK_LINES[visualStyle] : null,
    applied: { genre, visual_style: visualStyle },
    overrides: [],
    error: null,
  };
}
