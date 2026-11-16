/**
 * Plain-words helpers for the Direction section of a shot: the Director's ids become names, a
 * shot's window becomes a time range, its framing becomes one line. Pure.
 */
import type { ShotView, StagingView } from "@/server/blocks";

export type Names = Readonly<Record<string, string>>;

const ID = /@?\b((?:new_)?(?:char|loc|prop)_\d+)\b/g;

/** Replaces the Director's ids (`@char_1`, `char_1`) with the asset names they stand for. */
export function plain(text: string, names: Names): string {
  return stripRuleIds(text.replace(ID, (all, id: string) => names[id] ?? all));
}

// Not the asset ids (`char_12`), and not part of a longer word or an @mention.
const RULE_ID = String.raw`(?<![@\w])(?!(?:char|loc|prop)_)[a-z]{2,4}_\d{2}`;
const RULE_LIST = String.raw`${RULE_ID}(?:\s*[,;/&]\s*(?:and\s+)?${RULE_ID})*`;
const RULE_REFS = new RegExp(String.raw`\s*\(\s*${RULE_LIST}\s*\)|\s*\b${RULE_LIST}\b`, "g");

/** Drops the Director's rule references ("(dr_01)", "tbv_02, dr_03") from text a person reads. */
export function stripRuleIds(text: string): string {
  return text
    .replace(RULE_REFS, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

const FUNCTIONS: Readonly<Record<string, string>> = {
  setup: "Sets up the scene",
  escalation: "Raises the stakes",
  turn: "The turn",
  climax: "The peak",
  release: "The release",
  transition: "Moves on",
};

/** The dramatic function as a phrase; free text the Director wrote is shown as it is. */
export function functionLabel(text: string, names: Names): string {
  return FUNCTIONS[text.trim().toLowerCase()] ?? plain(text, names);
}

/** `"4-9s"` (also `"4–9 s"`, `"0-4.5s"`) as numbers, or null. */
export function parseWindow(window: string): { from: number; to: number } | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?\s*$/.exec(window);
  if (!match) return null;
  return { from: Number(match[1]), to: Number(match[2]) };
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "4–9 s" for a window, or the text as the Director wrote it. */
export function windowLabel(window: string): string {
  const parsed = parseWindow(window);
  return parsed ? `${trim(parsed.from)}–${trim(parsed.to)} s` : window.trim();
}

/** Segment lengths for the timeline strip (a shot with no readable window counts as one unit). */
export function windowLengths(shots: readonly ShotView[]): number[] {
  return shots.map((shot) => {
    const w = parseWindow(shot.window);
    return w && w.to > w.from ? w.to - w.from : 1;
  });
}

/** "Medium close-up · eye level · slow push-in": what the camera does in a shot. */
export function framing(shot: ShotView): string {
  return [shot.shot, shot.angle, shot.camera_height, shot.camera]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

const CONTINUITY: Readonly<Record<string, string>> = {
  first: "Opens the film",
  continuous: "Carries on from the shot before",
  hard_cut: "Cuts in from another moment",
  new_scene: "Starts a new scene",
};

export function continuityLabel(type: string): string | null {
  return CONTINUITY[type] ?? null;
}

const SIDE: Readonly<Record<string, string>> = {
  "frame-left": "frame left",
  "frame-right": "frame right",
  centre: "centre of frame",
  foreground: "foreground",
  background: "background",
};

const ZONE: Readonly<Record<string, string>> = {
  intimate: "very close",
  personal: "close",
  social: "conversation distance",
  public: "far apart",
};

/** One character's place in the frame, in plain words (the name apart from what follows it). */
export function stagingLine(s: StagingView, names: Names): { name: string; detail: string } {
  const name = names[s.character_id] ?? s.character_id;
  if (!s.on_screen) return { name, detail: "off screen" };
  const parts = [
    s.position.trim(),
    s.posture.trim(),
    SIDE[s.screen_side] ?? s.screen_side.trim(),
    s.facing.trim() ? `facing ${plain(s.facing.trim(), names)}` : "",
    s.gaze.trim() ? `looking ${plain(s.gaze.trim(), names)}` : "",
    ...s.distances
      .filter((d) => d.to.trim())
      .map((d) => `${ZONE[d.zone] ?? d.zone} to ${names[d.to] ?? d.to}`),
  ].filter(Boolean);
  return { name, detail: plain(parts.join(", "), names) };
}
