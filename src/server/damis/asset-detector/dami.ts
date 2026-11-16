/**
 * Asset Detector v2 (the owner's `asset_detector`, output_21): reads one accepted script and
 * returns every character, location and prop with evidence and scene references, plus a scene
 * index that also records who speaks in each scene (voices are not assets: they are added in
 * Production). `checkDetection` runs the owner's backend validators (section 8) and the prompt's
 * own cross-check (STEP 5); any issue triggers one corrective retry. `finalizeDetection` drops the
 * few evidence-bearing items whose evidence is not in the script (the owner's validator 5).
 */
import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { containsQuote, normalizeQuoteText } from "../shared/quotes";
import { buildAssetDetectorPrompt } from "./prompt";
import {
  assetDetectorInputSchema,
  assetDetectorOutputSchema,
  type AssetDetectorOutput,
  type AssetDetectorParsedInput,
} from "./schema";

/** More than this share of evidence not found in the script → corrective retry (validator 5). */
export const EVIDENCE_FAILURE_RATIO = 0.1;
/** The runner reports at most 20 issues; the last line says how many more there are. */
const MAX_ISSUES = 20;
const MAX_LISTED = 10;

/**
 * The text evidence is verified against: with `script.scenes`, each scene's heading and text
 * (heading, line break, text), scenes separated by a blank line; otherwise `raw_text`.
 */
export function detectorScriptText(input: AssetDetectorParsedInput): string {
  const scenes = input.script.scenes ?? [];
  if (scenes.length > 0) return scenes.map((s) => `${s.heading}\n${s.text}`).join("\n\n");
  return input.script.raw_text ?? "";
}

type EvidenceType = "characters" | "locations" | "props";
type EvidenceList =
  "facts" | "looks" | "voice_hints" | "states" | "fixed_elements_from_script" | "text_on_object";

/** One item that carries an `evidence` excerpt, with where it sits in the output. */
export type EvidenceItem = {
  /** Readable location, e.g. `char_1.facts[0]` (the asset's id, the list, the position). */
  path: string;
  evidence: string;
  type: EvidenceType;
  /** Position of the asset in its array. */
  index: number;
  list: EvidenceList;
  /** Position of the item in the asset's list. */
  itemIndex: number;
};

/**
 * Every evidence-bearing item: facts of characters (and their voice hints), locations and props, character
 * looks, location and prop states, fixed elements and text on objects.
 */
export function evidenceItems(output: AssetDetectorOutput): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const add = (
    type: EvidenceType,
    id: string,
    index: number,
    list: EvidenceList,
    entries: ReadonlyArray<{ evidence: string }>,
  ) => {
    entries.forEach((entry, itemIndex) => {
      items.push({
        path: `${id}.${list}[${itemIndex}]`,
        evidence: entry.evidence,
        type,
        index,
        list,
        itemIndex,
      });
    });
  };
  output.characters.forEach((c, i) => {
    add("characters", c.char_id, i, "facts", c.facts);
    add("characters", c.char_id, i, "looks", c.looks);
    add("characters", c.char_id, i, "voice_hints", c.voice_hints);
  });
  output.locations.forEach((l, i) => {
    add("locations", l.loc_id, i, "facts", l.facts);
    add("locations", l.loc_id, i, "states", l.states);
    add("locations", l.loc_id, i, "fixed_elements_from_script", l.fixed_elements_from_script);
  });
  output.props.forEach((p, i) => {
    add("props", p.prop_id, i, "facts", p.facts);
    add("props", p.prop_id, i, "states", p.states);
    add("props", p.prop_id, i, "text_on_object", p.text_on_object);
  });
  return items;
}

/** Evidence that is blank or not found in the script (after quote normalization). */
function failingEvidence(output: AssetDetectorOutput, script: string): EvidenceItem[] {
  return evidenceItems(output).filter(
    (item) => !normalizeQuoteText(item.evidence) || !containsQuote(script, item.evidence),
  );
}

/**
 * Whether a scene's text has at least one dialogue block: a paragraph whose first line is an
 * upper-case character cue (optionally with an extension such as (V.O.)) followed by a spoken
 * line. Deliberately conservative: scripts without upper-case cues (Persian, say) count as none.
 */
export function hasDialogue(text: string): boolean {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .some((block) => {
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const cue = lines[0];
      if (lines.length < 2 || cue === undefined) return false;
      if (/[.:]$/.test(cue) || cue.length > 50) return false;
      const name = cue.replace(/\s*\([^)]*\)\s*$/, "").trim();
      return /^[A-Z][A-Z0-9 '’.-]*$/.test(name) && name.split(/\s+/).length <= 4;
    });
}

function listed(values: readonly string[], max = MAX_LISTED): string {
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} and ${values.length - max} more` : shown;
}

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

function mentions(text: string, id: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${id}(?![A-Za-z0-9_])`).test(text);
}

function nameKeyOf(name: string): string {
  return normalizeQuoteText(name).toLowerCase();
}

/**
 * The owner's validators (section 8) and cross-checks (STEP 6). Messages are fed back to the model,
 * so each one says what is wrong and what to do.
 */
export function checkDetection(
  output: AssetDetectorOutput,
  input: AssetDetectorParsedInput,
): string[] {
  const issues: string[] = [];
  const { scene_index: index, characters, locations, props } = output;

  // Mode.
  if (output.mode !== input.mode) {
    issues.push(
      `mode is "${output.mode}" but the input mode is "${input.mode}"; use "${input.mode}"`,
    );
  }
  if (input.mode === "full") {
    const { added, updated, removed } = output.diff;
    if (added.length + updated.length + removed.length > 0) {
      issues.push("in full mode diff.added, diff.updated and diff.removed must all be empty");
    }
  }
  if (input.mode !== "fix" && output.applied_fixes.length > 0) {
    issues.push(`applied_fixes must be empty in ${input.mode} mode`);
  }
  if (input.mode === "fix" && output.applied_fixes.length === 0) {
    issues.push(
      "fix mode: list every request of fix_requests in applied_fixes as {code, target_ids, change}",
    );
  }

  // 1. Summary counts.
  const counts: Array<[keyof AssetDetectorOutput["summary"], number, string]> = [
    ["scene_count", index.length, "scene_index"],
    ["character_count", characters.length, "characters"],
    ["location_count", locations.length, "locations"],
    ["prop_count", props.length, "props"],
  ];
  for (const [field, actual, array] of counts) {
    if (output.summary[field] !== actual) {
      issues.push(
        `summary.${field} is ${output.summary[field]} but ${array} has ${actual} entries; set it to ${actual}`,
      );
    }
  }

  // 2. Scene index: one entry per scene, in order.
  const sceneNumbers = index.map((s) => s.scene_number);
  const inputScenes = input.script.scenes ?? [];
  if (inputScenes.length > 0) {
    const expected = inputScenes.map((s) => s.scene_number);
    const missing = expected.filter((n) => !sceneNumbers.includes(n));
    const extra = sceneNumbers.filter((n) => !expected.includes(n));
    if (missing.length > 0) {
      issues.push(
        `scene_index is missing scene(s) ${listed(missing)}; add exactly one entry per input scene`,
      );
    }
    if (extra.length > 0) {
      issues.push(
        `scene_index has scene number(s) not in the input: ${listed(extra)}; use the input scene_number values exactly`,
      );
    }
    if (
      missing.length === 0 &&
      extra.length === 0 &&
      sceneNumbers.join("|") !== expected.join("|")
    ) {
      issues.push(
        `scene_index must list each input scene once, in script order: ${listed(expected, 30)}`,
      );
    }
  } else {
    const expected = index.map((_, i) => String(i + 1));
    if (sceneNumbers.join("|") !== expected.join("|")) {
      issues.push(
        `scene_index scene numbers must be "1", "2", "3" ... in order when the script is raw_text`,
      );
    }
    const raw = input.script.raw_text ?? "";
    index.forEach((s) => {
      if (s.anchor !== null && !containsQuote(raw, s.anchor)) {
        issues.push(
          `scene_index scene ${s.scene_number}: the anchor is not in the script; copy the first 6 to 12 words of the scene exactly`,
        );
      }
    });
  }
  const dupScenes = duplicatesOf(sceneNumbers);
  if (dupScenes.length > 0) {
    issues.push(`scene_index lists scene(s) ${listed(dupScenes)} more than once`);
  }

  // 3. Ids: unique, and every reference resolves.
  const charIds = new Set(characters.map((c) => c.char_id));
  const locIds = new Set(locations.map((l) => l.loc_id));
  const propIds = new Set(props.map((p) => p.prop_id));
  const allIds = new Set([...charIds, ...locIds, ...propIds]);
  const knownIds = new Set((input.known_assets ?? []).map((k) => k.id));
  for (const [label, ids] of [
    ["char_id", characters.map((c) => c.char_id)],
    ["loc_id", locations.map((l) => l.loc_id)],
    ["prop_id", props.map((p) => p.prop_id)],
  ] as const) {
    const dup = duplicatesOf(ids);
    if (dup.length > 0) {
      issues.push(`${label} ${listed(dup)} is used by more than one entry; ids must be unique`);
    }
  }
  const unknown = (where: string, id: string, what: string) => {
    issues.push(`${where} refers to ${what} "${id}", which does not exist in this output`);
  };
  const refsExist = (
    ids: readonly string[],
    known: ReadonlySet<string>,
    where: string,
    what: string,
  ) => {
    for (const id of ids) if (!known.has(id)) unknown(where, id, what);
  };
  const sceneOrder = new Map(sceneNumbers.map((n, i) => [n, i]));
  const looksOf = new Map(
    characters.map((c) => [c.char_id, new Set(c.looks.map((l) => l.look_id))]),
  );
  const statesOf = new Map(
    locations.map((l) => [l.loc_id, new Set(l.states.map((s) => s.state_id))]),
  );

  index.forEach((s) => {
    const at = `scene_index scene ${s.scene_number}`;
    refsExist(s.characters_present, charIds, `${at} characters_present`, "character");
    refsExist(s.heard_only, charIds, `${at} heard_only`, "character");
    refsExist(s.speakers, charIds, `${at} speakers`, "character");
    refsExist(s.props_present, propIds, `${at} props_present`, "prop");
    s.char_looks.forEach(({ char_id, look_id }) => {
      if (!charIds.has(char_id)) unknown(`${at} char_looks`, char_id, "character");
      else if (!looksOf.get(char_id)?.has(look_id)) {
        issues.push(
          `${at} char_looks: ${char_id} has no look "${look_id}"; add the look or remove the entry`,
        );
      }
    });
    if (s.location_id !== null && !locIds.has(s.location_id)) {
      unknown(`${at} location_id`, s.location_id, "location");
    }
    if (s.location_state_id !== null) {
      if (s.location_id === null) {
        issues.push(`${at}: location_state_id is set but location_id is null`);
      } else if (
        locIds.has(s.location_id) &&
        !statesOf.get(s.location_id)?.has(s.location_state_id)
      ) {
        issues.push(
          `${at}: location_state_id "${s.location_state_id}" is not a state of ${s.location_id}`,
        );
      }
    }
  });

  const checkSceneRefs = (id: string, refs: readonly string[], firstScene: string | null) => {
    if (refs.length === 0) {
      issues.push(`${id} has no scene_refs; every asset needs at least one scene`);
      return;
    }
    const bad = refs.filter((r) => !sceneOrder.has(r));
    if (bad.length > 0) {
      issues.push(`${id}.scene_refs has scene(s) ${listed(bad)} that are not in scene_index`);
    }
    if (firstScene !== null) {
      const known = refs.filter((r) => sceneOrder.has(r));
      const earliest = known.reduce<string | undefined>(
        (best, r) =>
          best === undefined || (sceneOrder.get(r) ?? 0) < (sceneOrder.get(best) ?? 0) ? r : best,
        undefined,
      );
      if (earliest !== undefined && firstScene !== earliest) {
        issues.push(`${id}.first_scene is "${firstScene}" but its earliest scene is "${earliest}"`);
      }
    }
  };
  const subRefs = (path: string, refs: readonly string[]) => {
    const bad = refs.filter((r) => !sceneOrder.has(r));
    if (bad.length > 0)
      issues.push(`${path}.scene_refs has scene(s) ${listed(bad)} that are not in scene_index`);
  };

  for (const c of characters) {
    checkSceneRefs(c.char_id, c.scene_refs, c.first_scene);
    c.looks.forEach((l) => subRefs(`${c.char_id} look ${l.look_id}`, l.scene_refs));
    const dupLooks = duplicatesOf(c.looks.map((l) => l.look_id));
    if (dupLooks.length > 0) issues.push(`${c.char_id} has duplicate look_id ${listed(dupLooks)}`);
    if (c.same_person_as !== null) {
      if (!charIds.has(c.same_person_as))
        unknown(`${c.char_id}.same_person_as`, c.same_person_as, "character");
      else if (c.same_person_as === c.char_id)
        issues.push(`${c.char_id}.same_person_as points to itself`);
    }
    refsExist(
      c.relationships.map((r) => r.char_id),
      charIds,
      `${c.char_id}.relationships`,
      "character",
    );
    refsExist(c.signature_prop_ids, propIds, `${c.char_id}.signature_prop_ids`, "prop");
  }
  for (const l of locations) {
    checkSceneRefs(l.loc_id, l.scene_refs, l.first_scene);
    l.states.forEach((s) => subRefs(`${l.loc_id} state ${s.state_id}`, s.scene_refs));
    const dupStates = duplicatesOf(l.states.map((s) => s.state_id));
    if (dupStates.length > 0)
      issues.push(`${l.loc_id} has duplicate state_id ${listed(dupStates)}`);
    refsExist(l.related_asset_ids, allIds, `${l.loc_id}.related_asset_ids`, "asset");
  }
  for (const p of props) {
    checkSceneRefs(p.prop_id, p.scene_refs, p.first_scene);
    p.states.forEach((s) => subRefs(`${p.prop_id} state ${s.state_id}`, s.scene_refs));
    refsExist(p.users, charIds, `${p.prop_id}.users`, "character");
    refsExist(p.location_ids, locIds, `${p.prop_id}.location_ids`, "location");
    refsExist(p.related_asset_ids, allIds, `${p.prop_id}.related_asset_ids`, "asset");
  }
  for (const list of ["added", "updated"] as const) {
    output.diff[list].forEach((id) => {
      if (!allIds.has(id) && !knownIds.has(id)) unknown(`diff.${list}`, id, "asset");
    });
  }

  // 4. Scene consistency, both ways.
  const consistency = (
    id: string,
    refs: readonly string[],
    inScene: (n: string) => boolean,
    how: string,
  ) => {
    const refSet = new Set(refs);
    const missing = sceneNumbers.filter((n) => inScene(n) && !refSet.has(n));
    const extra = refs.filter((n) => sceneOrder.has(n) && !inScene(n));
    if (missing.length > 0) {
      issues.push(
        `${id} is ${how} in scene(s) ${listed(missing)} but they are missing from its scene_refs`,
      );
    }
    if (extra.length > 0) {
      issues.push(
        `${id}.scene_refs lists scene(s) ${listed(extra)} but it is not ${how} there in scene_index; fix scene_refs or scene_index`,
      );
    }
  };
  const sceneByNumber = new Map(index.map((s) => [s.scene_number, s]));
  for (const c of characters) {
    consistency(
      c.char_id,
      c.scene_refs,
      (n) => {
        const s = sceneByNumber.get(n);
        return (
          !!s && (s.characters_present.includes(c.char_id) || s.heard_only.includes(c.char_id))
        );
      },
      "present (characters_present, or heard_only)",
    );
  }
  for (const p of props) {
    consistency(
      p.prop_id,
      p.scene_refs,
      (n) => !!sceneByNumber.get(n)?.props_present.includes(p.prop_id),
      "in props_present",
    );
  }
  for (const l of locations) {
    consistency(
      l.loc_id,
      l.scene_refs,
      (n) => sceneByNumber.get(n)?.location_id === l.loc_id,
      "the location_id",
    );
  }

  // 5. Evidence: more than 10% not found → retry; fewer are dropped by finalize.
  const items = evidenceItems(output);
  const failing = failingEvidence(output, detectorScriptText(input));
  if (items.length > 0 && failing.length / items.length > EVIDENCE_FAILURE_RATIO) {
    issues.push(
      `${failing.length} of ${items.length} evidence excerpts are not in the script (${listed(failing.map((f) => f.path))}). Copy each evidence character for character from the script (at most 20 words, original language, no translation or paraphrase), or remove the item`,
    );
  }

  // 4 (cont.). Every speaker is in the scene (seen or heard) and speaks.
  const charById = new Map(characters.map((c) => [c.char_id, c]));
  for (const s of index) {
    for (const id of s.speakers) {
      const speaker = charById.get(id);
      if (!speaker) continue; // reported above as an unknown id
      if (!s.characters_present.includes(id) && !s.heard_only.includes(id)) {
        issues.push(
          `scene_index scene ${s.scene_number}: speaker ${id} is in neither characters_present nor heard_only; add it to one of them`,
        );
      }
      if (!speaker.speaks) {
        issues.push(
          `scene_index scene ${s.scene_number}: speaker ${id} has speaks false; set speaks true on the character or remove it from speakers`,
        );
      }
    }
  }

  // 6. A scene whose text has dialogue lists its speakers.
  const sceneTexts = new Map(inputScenes.map((s) => [s.scene_number, s.text]));
  for (const s of index) {
    const text = sceneTexts.get(s.scene_number);
    if (text !== undefined && s.speakers.length === 0 && hasDialogue(text)) {
      issues.push(
        `scene_index scene ${s.scene_number}: the scene text has dialogue but speakers is empty; list every character who speaks in it`,
      );
    }
  }

  // 7. No duplicate name or alias inside one type unless linked or flagged MERGE_CHECK.
  const mergeChecks = output.warnings.filter((w) => w.trimStart().startsWith("MERGE_CHECK:"));
  const linked = (a: string, b: string) => {
    const ca = charById.get(a);
    const cb = charById.get(b);
    if (ca && cb) {
      if (ca.same_person_as === b || cb.same_person_as === a) return true;
      if (ca.same_person_as !== null && ca.same_person_as === cb.same_person_as) return true;
    }
    return mergeChecks.some((w) => mentions(w, a) && mentions(w, b));
  };
  const named: Array<[string, ReadonlyArray<{ id: string; labels: string[] }>]> = [
    ["characters", characters.map((c) => ({ id: c.char_id, labels: [c.name, ...c.aliases] }))],
    ["locations", locations.map((l) => ({ id: l.loc_id, labels: [l.name, ...l.aliases] }))],
    ["props", props.map((p) => ({ id: p.prop_id, labels: [p.name, ...p.aliases] }))],
  ];
  for (const [type, entries] of named) {
    const owners = new Map<string, string[]>();
    for (const e of entries) {
      for (const key of new Set(e.labels.map(nameKeyOf).filter(Boolean))) {
        owners.set(key, [...(owners.get(key) ?? []), e.id]);
      }
    }
    for (const [key, ids] of owners) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i] as string;
          const b = ids[j] as string;
          if (a !== b && !linked(a, b)) {
            issues.push(
              `${type} ${a} and ${b} share the name or alias "${key}"; merge them into one entry, link them with same_person_as, or add a warning "MERGE_CHECK: ${a} and ${b} may be the same (reason)"`,
            );
          }
        }
      }
    }
  }

  if (issues.length > MAX_ISSUES) {
    const rest = issues.length - (MAX_ISSUES - 1);
    return [
      ...issues.slice(0, MAX_ISSUES - 1),
      `...and ${rest} more issues of the kinds above; fix them all`,
    ];
  }
  return issues;
}

/**
 * Validator 5's repair: drops every evidence-bearing item whose evidence is not in the script and
 * adds one assumption per dropped item. Scene index references to a dropped look or location state
 * are cleared. Output without failures is returned unchanged.
 */
export function finalizeDetection(
  output: AssetDetectorOutput,
  input: AssetDetectorParsedInput,
): AssetDetectorOutput {
  const failing = failingEvidence(output, detectorScriptText(input));
  if (failing.length === 0) return output;
  const next = structuredClone(output);
  const drop = new Set(failing.map((f) => `${f.type}|${f.index}|${f.list}|${f.itemIndex}`));
  const keep = (type: EvidenceType, index: number, list: EvidenceList) => (_: unknown, i: number) =>
    !drop.has(`${type}|${index}|${list}|${i}`);
  const droppedLooks = new Set<string>();
  const droppedStates = new Set<string>();
  next.characters.forEach((c, i) => {
    c.facts = c.facts.filter(keep("characters", i, "facts"));
    c.voice_hints = c.voice_hints.filter(keep("characters", i, "voice_hints"));
    const looks = c.looks.filter(keep("characters", i, "looks"));
    c.looks
      .filter((l) => !looks.includes(l))
      .forEach((l) => droppedLooks.add(`${c.char_id}|${l.look_id}`));
    c.looks = looks;
  });
  next.locations.forEach((l, i) => {
    l.facts = l.facts.filter(keep("locations", i, "facts"));
    const states = l.states.filter(keep("locations", i, "states"));
    l.states
      .filter((s) => !states.includes(s))
      .forEach((s) => droppedStates.add(`${l.loc_id}|${s.state_id}`));
    l.states = states;
    l.fixed_elements_from_script = l.fixed_elements_from_script.filter(
      keep("locations", i, "fixed_elements_from_script"),
    );
  });
  next.props.forEach((p, i) => {
    p.facts = p.facts.filter(keep("props", i, "facts"));
    p.states = p.states.filter(keep("props", i, "states"));
    p.text_on_object = p.text_on_object.filter(keep("props", i, "text_on_object"));
  });
  for (const s of next.scene_index) {
    s.char_looks = s.char_looks.filter((cl) => !droppedLooks.has(`${cl.char_id}|${cl.look_id}`));
    if (
      s.location_id !== null &&
      s.location_state_id !== null &&
      droppedStates.has(`${s.location_id}|${s.location_state_id}`)
    ) {
      s.location_state_id = null;
    }
  }
  next.assumptions = [
    ...next.assumptions,
    ...failing.map((f) => `fact removed: evidence not found (${f.path})`),
  ];
  return next;
}

export const assetDetector = defineDami({
  key: "asset-detector",
  version: "2.0.0",
  description:
    "The owner's Asset Detector v2: lists every character, location and prop of an accepted script with evidence and scene references, plus a scene index that records who speaks in each scene (output_21).",
  input: assetDetectorInputSchema,
  output: assetDetectorOutputSchema,
  // The owner's file: claude-sonnet-5-5, max_tokens 32000.
  model: CLAUDE_MODELS.sonnet,
  // The owner asks for temperature 0; the SDK has no temperature, so `low` effort stands in for
  // it (docs/damis/README.md, "Settings that differ from the files").
  effort: "low",
  maxOutputTokens: 32_000,
  build: buildAssetDetectorPrompt,
  check: checkDetection,
  finalize: finalizeDetection,
});
