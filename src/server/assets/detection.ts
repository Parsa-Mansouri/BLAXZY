/**
 * The Asset Detector boundary. The detector speaks `char_1` / `loc_1` / `prop_1` / `voice_1`;
 * BLAXZY identifies assets by kind and real name. For one run, `detectorView` gives the stored
 * assets temporary ids (as `known_assets`, and as `previous_output` for a fix round), and
 * `planDetection` turns the detector's answer back into names: which rows to update, which to
 * insert (with unique names), which to remove, and the scene index and diff in names. Pure: no
 * database, no Claude. The temporary ids live only in memory for the run.
 */
import {
  cleanAssetName,
  formatAssetRef,
  nameKey,
  uniqueName,
  type AssetDetectorOutput,
  type DetectedCharacter,
  type DetectedLocation,
  type DetectedProp,
  type DetectedVoice,
  type DetectorFact,
  type KnownAsset,
  type SceneIndexEntry,
} from "@/server/damis";
import type {
  AssetDetails,
  AssetFact,
  AssetKind,
  AssetPriority,
  DetectionDiff,
  DetectionSceneIndexEntry,
  asset,
} from "@/server/db/schema";

type Asset = typeof asset.$inferSelect;

/** The kinds the detector manages. Legacy creature, costume and other rows are left alone. */
export const DETECTED_KINDS = ["character", "location", "prop", "voice"] as const;
export type DetectedKind = (typeof DETECTED_KINDS)[number];

export function isDetectedKind(kind: AssetKind): kind is DetectedKind {
  return (DETECTED_KINDS as readonly string[]).includes(kind);
}

export type KnownStatus = "detected" | "in_progress" | "approved";
export type KnownRow = { asset: Asset; status: KnownStatus };

const PREFIX: Record<DetectedKind, string> = {
  character: "char",
  location: "loc",
  prop: "prop",
  voice: "voice",
};

/** A temporary id, also inside a longer id the detector built from it (`loc_1_night`). */
const TEMP_ID = /\b(?:char|loc|prop|voice)_\d+(?![0-9])/g;

export type DetectorView = {
  known: KnownAsset[];
  /** temp id → stored asset (characters that are only a voice map to their voice asset). */
  byTemp: Map<string, Asset>;
  /** `kind:name-key` → temp id. */
  tempByName: Map<string, string>;
  previousOutput: AssetDetectorOutput;
};

const refKey = (kind: string, name: string) => `${kind}:${nameKey(name)}`;

function toDetectorFact(f: AssetFact): DetectorFact {
  return {
    field: f.field,
    value: f.value,
    status: f.status === "implied" ? "implied" : "stated",
    scene: f.scene,
    evidence: f.evidence,
  };
}

function priorityOut(p: AssetPriority): "required" | "optional" {
  return p === "required" ? "required" : "optional";
}

/**
 * The stored (active) assets as the detector sees them: temporary ids by kind in display order,
 * each rebuilt as an output_21 entry from its details. `sceneIndex` (the latest detection's) is
 * translated back too, so a fix round gets a complete `previous_output`.
 */
export function detectorView(
  rows: readonly KnownRow[],
  sceneIndex: readonly DetectionSceneIndexEntry[],
  mode: AssetDetectorOutput["mode"] = "fix",
): DetectorView {
  const active = rows.filter((r) => r.asset.status === "active" && isDetectedKind(r.asset.kind));
  const counters: Record<string, number> = { char: 0, loc: 0, prop: 0, voice: 0 };
  const byTemp = new Map<string, Asset>();
  const tempByName = new Map<string, string>();
  const statusByTemp = new Map<string, KnownStatus>();
  const next = (prefix: string) => `${prefix}_${++counters[prefix]!}`;

  for (const r of active) {
    const kind = r.asset.kind as DetectedKind;
    const id = next(PREFIX[kind]);
    byTemp.set(id, r.asset);
    statusByTemp.set(id, r.status);
    tempByName.set(refKey(kind, r.asset.name), id);
  }
  // A voice whose owner has no character asset (heard, never seen) gets a voice_only character.
  for (const r of active) {
    if (r.asset.kind !== "voice") continue;
    const owner = r.asset.details?.owner ?? r.asset.name;
    if (!tempByName.has(refKey("character", owner))) {
      const id = next("char");
      byTemp.set(id, r.asset);
      statusByTemp.set(id, r.status);
      tempByName.set(refKey("character", owner), id);
    }
  }
  const temp = (kind: DetectedKind, name: string | null | undefined) =>
    name ? (tempByName.get(refKey(kind, name)) ?? null) : null;
  const temps = (kind: DetectedKind, names: readonly string[] | undefined) =>
    (names ?? []).map((n) => temp(kind, n)).filter((t): t is string => t !== null);
  const relatedTemps = (refs: readonly string[] | undefined) =>
    (refs ?? [])
      .map((ref) => {
        const colon = ref.indexOf(":");
        const kind = ref.slice(0, colon);
        return isDetectedKind(kind as AssetKind)
          ? temp(kind as DetectedKind, ref.slice(colon + 1))
          : null;
      })
      .filter((t): t is string => t !== null);

  const characters: DetectedCharacter[] = [];
  const locations: DetectedLocation[] = [];
  const props: DetectedProp[] = [];
  const voices: DetectedVoice[] = [];
  for (const [id, a] of byTemp) {
    const d: AssetDetails = a.details ?? {};
    const common = {
      name: d.owner && id.startsWith("char_") && a.kind === "voice" ? d.owner : a.name,
      name_latin: d.nameLatin ?? a.name,
      aliases: d.aliases ?? [],
      script_description: a.description ?? "",
      facts: (d.facts ?? []).map(toDetectorFact),
      asset_priority: priorityOut(a.priority),
      scene_refs: d.sceneRefs ?? [],
      first_scene: d.firstScene ?? d.sceneRefs?.[0] ?? "",
      ui_summary: d.uiSummary ?? a.description ?? "",
    };
    if (id.startsWith("char_")) {
      const voiceOnly = a.kind === "voice";
      characters.push({
        char_id: id,
        ...common,
        kind: voiceOnly
          ? "voice_only"
          : ((d.subkind as DetectedCharacter["kind"] | undefined) ?? "human"),
        role: (d.role as DetectedCharacter["role"] | undefined) ?? "supporting",
        needs_visual: voiceOnly ? false : (d.needsVisual ?? true),
        is_minor: d.isMinor ?? "unknown",
        same_person_as: temp("character", d.samePersonAs ?? null),
        looks: (d.looks ?? []).map((l) => ({
          look_id: l.id,
          description: l.description,
          scene_refs: l.sceneRefs,
          evidence: l.evidence,
        })),
        signature_prop_ids: temps("prop", d.signatureProps),
        speaks: voiceOnly ? true : (d.speaks ?? false),
        dialogue_line_count: d.dialogueLineCount ?? 0,
        relationships: (d.relationships ?? [])
          .map((r) => ({ char_id: temp("character", r.name), relation: r.relation }))
          .filter((r): r is { char_id: string; relation: string } => r.char_id !== null),
      });
    } else if (id.startsWith("loc_")) {
      locations.push({
        loc_id: id,
        ...common,
        location_group: d.locationGroup ?? null,
        interior_exterior: d.interiorExterior ?? "interior",
        time_of_day: (d.timeOfDay as DetectedLocation["time_of_day"] | undefined) ?? "unspecified",
        times_of_day: (d.timesOfDay ?? []) as DetectedLocation["times_of_day"],
        states: (d.states ?? []).map((s) => ({
          state_id: s.id,
          description: s.description,
          scene_refs: s.sceneRefs,
          evidence: s.evidence,
        })),
        fixed_elements_from_script: d.fixedElements ?? [],
        related_asset_ids: relatedTemps(d.relatedAssets),
      });
    } else if (id.startsWith("prop_")) {
      props.push({
        prop_id: id,
        ...common,
        category_hint: (d.categoryHint as DetectedProp["category_hint"] | undefined) ?? "hand_prop",
        subtype: d.subtype ?? null,
        states: (d.states ?? []).map((s) => ({
          state_id: s.id,
          description: s.description,
          scene_refs: s.sceneRefs,
          evidence: s.evidence,
        })),
        text_on_object: d.textOnObject ?? [],
        users: temps("character", d.users),
        location_ids: temps("location", d.locationIds),
        related_asset_ids: relatedTemps(d.relatedAssets),
      });
    } else {
      voices.push({
        voice_id: id,
        owner_char_id: temp("character", d.owner ?? a.name) ?? "",
        delivery: (d.delivery ?? ["on_screen"]) as DetectedVoice["delivery"],
        language: d.language ?? "",
        hints: (d.hints ?? []).map(toDetectorFact),
        dialogue_line_count: d.dialogueLineCount ?? 0,
        scene_refs: d.sceneRefs ?? [],
        ui_summary: d.uiSummary ?? a.description ?? "",
      });
    }
  }

  const scene_index: SceneIndexEntry[] = sceneIndex.map((s) => ({
    scene_number: s.sceneNumber,
    heading: s.heading,
    anchor: s.anchor,
    location_id: temp("location", s.location),
    location_state_id: s.locationState,
    time_of_day: s.timeOfDay as SceneIndexEntry["time_of_day"],
    characters_present: temps("character", s.characters),
    char_looks: s.characterLooks
      .map((l) => ({ char_id: temp("character", l.character), look_id: l.look }))
      .filter((l): l is { char_id: string; look_id: string } => l.char_id !== null),
    voices_heard: temps("voice", s.voices),
    props_present: temps("prop", s.props),
  }));

  const entryOf = (id: string): Record<string, unknown> =>
    characters.find((c) => c.char_id === id) ??
    locations.find((l) => l.loc_id === id) ??
    props.find((p) => p.prop_id === id) ??
    voices.find((v) => v.voice_id === id) ??
    {};
  const known: KnownAsset[] = [...byTemp.keys()].map((id) => ({
    id,
    status: statusByTemp.get(id) ?? "detected",
    entry: entryOf(id),
  }));

  return {
    known,
    byTemp,
    tempByName,
    previousOutput: {
      output_version: "output_21",
      mode,
      scene_index,
      characters,
      locations,
      props,
      voices,
      diff: { added: [], updated: [], removed: [] },
      summary: {
        scene_count: scene_index.length,
        character_count: characters.length,
        location_count: locations.length,
        prop_count: props.length,
        voice_count: voices.length,
      },
      applied_fixes: [],
      assumptions: [],
      warnings: [],
    },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Back to names                                                                               */
/* ------------------------------------------------------------------------------------------ */

export type PlannedAsset = {
  tempId: string;
  kind: DetectedKind;
  /** The stored row this entry is (kept name), or null for a new asset. */
  existing: Asset | null;
  name: string;
  description: string | null;
  priority: "required" | "optional";
  details: AssetDetails;
};

export type DetectionPlan = {
  assets: PlannedAsset[];
  /** Stored rows the detector removed (diff.removed). */
  removed: Asset[];
  sceneIndex: DetectionSceneIndexEntry[];
  diff: DetectionDiff;
  assumptions: string[];
  warnings: string[];
};

function fromFact(f: DetectorFact): AssetFact {
  return { field: f.field, value: f.value, status: f.status, scene: f.scene, evidence: f.evidence };
}

/**
 * The detector's answer in names. Entries matching a stored row (through `byTemp`) keep that
 * row's name; a new entry whose name matches a removed detected row of its kind revives it;
 * other new entries get a unique name ("Mara (2)"). `voice_only` characters become voice assets
 * only. Temporary ids inside warnings and assumptions are replaced by names.
 */
export function planDetection(input: {
  output: AssetDetectorOutput;
  byTemp: ReadonlyMap<string, Asset>;
  /** Every stored row of the project (for unique names and revivals). */
  existing: readonly Asset[];
}): DetectionPlan {
  const { output, byTemp } = input;
  const taken = new Map<string, string[]>();
  for (const a of input.existing) taken.set(a.kind, [...(taken.get(a.kind) ?? []), a.name]);
  const usedRows = new Set<string>();
  const names = new Map<string, { kind: DetectedKind; name: string; row: Asset | null }>();

  const resolve = (tempId: string, kind: DetectedKind, wanted: string) => {
    const known = byTemp.get(tempId);
    if (known && known.kind === kind && !usedRows.has(known.id)) {
      usedRows.add(known.id);
      names.set(tempId, { kind, name: known.name, row: known });
      return;
    }
    const clean = cleanAssetName(wanted) || `${kind} ${tempId.split("_")[1] ?? ""}`.trim();
    const revived = input.existing.find(
      (a) =>
        a.kind === kind &&
        a.status === "removed" &&
        a.origin === "detected" &&
        !usedRows.has(a.id) &&
        nameKey(a.name) === nameKey(clean),
    );
    if (revived) {
      usedRows.add(revived.id);
      names.set(tempId, { kind, name: revived.name, row: revived });
      return;
    }
    const name = uniqueName(clean, taken.get(kind) ?? []);
    taken.set(kind, [...(taken.get(kind) ?? []), name]);
    names.set(tempId, { kind, name, row: null });
  };

  const charName = new Map<string, string>();
  for (const c of output.characters) {
    if (c.kind === "voice_only") {
      charName.set(c.char_id, cleanAssetName(c.name) || c.name_latin);
      continue;
    }
    resolve(c.char_id, "character", c.name);
    charName.set(c.char_id, names.get(c.char_id)?.name ?? c.name);
  }
  for (const l of output.locations) resolve(l.loc_id, "location", l.name);
  for (const p of output.props) resolve(p.prop_id, "prop", p.name);
  for (const v of output.voices) {
    const owner = output.characters.find((c) => c.char_id === v.owner_char_id);
    const knownVoice = byTemp.get(v.voice_id);
    resolve(
      v.voice_id,
      "voice",
      knownVoice?.name ?? charName.get(v.owner_char_id) ?? owner?.name ?? "Voice",
    );
  }

  const nameOf = (tempId: string | null | undefined): string | null =>
    tempId ? (names.get(tempId)?.name ?? charName.get(tempId) ?? null) : null;
  const namesOf = (ids: readonly string[]) =>
    ids.map((id) => nameOf(id)).filter((n): n is string => n !== null);
  const refOf = (tempId: string): string | null => {
    const n = names.get(tempId);
    return n ? formatAssetRef(n.kind, n.name) : null;
  };
  const refsOf = (ids: readonly string[]) => ids.map(refOf).filter((r): r is string => r !== null);
  const translate = (text: string) => text.replace(TEMP_ID, (id) => nameOf(id) ?? "another asset");
  // Look and state ids the detector built from its own ids (`loc_1_night`) are stored name-based
  // (`Ferry_Cabin_night`), so no temporary id reaches the database.
  const localId = (id: string) =>
    id.replace(TEMP_ID, (t) => (nameOf(t) ?? "asset").trim().replace(/\s+/g, "_"));

  const assets: PlannedAsset[] = [];
  const push = (
    tempId: string,
    kind: DetectedKind,
    description: string,
    priority: "required" | "optional",
    details: AssetDetails,
  ) => {
    const n = names.get(tempId);
    if (!n) return;
    assets.push({
      tempId,
      kind,
      existing: n.row,
      name: n.name,
      description: description.trim() || null,
      priority,
      details: { ...details, detectedPriority: priority },
    });
  };

  for (const c of output.characters) {
    if (c.kind === "voice_only") continue;
    push(c.char_id, "character", c.script_description, c.asset_priority, {
      subkind: c.kind,
      role: c.role,
      aliases: c.aliases,
      nameLatin: c.name_latin,
      isMinor: c.is_minor,
      needsVisual: c.needs_visual,
      samePersonAs: nameOf(c.same_person_as),
      facts: c.facts.map(fromFact),
      looks: c.looks.map((l) => ({
        id: localId(l.look_id),
        description: l.description,
        sceneRefs: l.scene_refs,
        evidence: l.evidence,
      })),
      sceneRefs: c.scene_refs,
      firstScene: c.first_scene,
      uiSummary: c.ui_summary,
      relationships: c.relationships
        .map((r) => ({ name: nameOf(r.char_id), relation: r.relation }))
        .filter((r): r is { name: string; relation: string } => r.name !== null),
      signatureProps: namesOf(c.signature_prop_ids),
      speaks: c.speaks,
      dialogueLineCount: c.dialogue_line_count,
    });
  }
  for (const l of output.locations) {
    push(l.loc_id, "location", l.script_description, l.asset_priority, {
      aliases: l.aliases,
      nameLatin: l.name_latin,
      locationGroup: l.location_group,
      interiorExterior: l.interior_exterior,
      timeOfDay: l.time_of_day,
      timesOfDay: l.times_of_day,
      states: l.states.map((s) => ({
        id: localId(s.state_id),
        description: s.description,
        sceneRefs: s.scene_refs,
        evidence: s.evidence,
      })),
      facts: l.facts.map(fromFact),
      fixedElements: l.fixed_elements_from_script,
      relatedAssets: refsOf(l.related_asset_ids),
      sceneRefs: l.scene_refs,
      firstScene: l.first_scene,
      uiSummary: l.ui_summary,
    });
  }
  for (const p of output.props) {
    push(p.prop_id, "prop", p.script_description, p.asset_priority, {
      aliases: p.aliases,
      nameLatin: p.name_latin,
      categoryHint: p.category_hint,
      subtype: p.subtype,
      facts: p.facts.map(fromFact),
      states: p.states.map((s) => ({
        id: localId(s.state_id),
        description: s.description,
        sceneRefs: s.scene_refs,
        evidence: s.evidence,
      })),
      textOnObject: p.text_on_object,
      users: namesOf(p.users),
      locationIds: namesOf(p.location_ids),
      relatedAssets: refsOf(p.related_asset_ids),
      sceneRefs: p.scene_refs,
      firstScene: p.first_scene,
      uiSummary: p.ui_summary,
    });
  }
  for (const v of output.voices) {
    const owner = output.characters.find((c) => c.char_id === v.owner_char_id);
    const description =
      owner?.kind === "voice_only" && owner.script_description
        ? owner.script_description
        : [v.ui_summary, ...v.hints.map((h) => `${h.field}: ${h.value}`)].join(" ");
    push(v.voice_id, "voice", description, owner?.asset_priority ?? "required", {
      owner: nameOf(v.owner_char_id) ?? undefined,
      ...(owner?.kind === "voice_only"
        ? { subkind: "voice_only", aliases: owner.aliases, isMinor: owner.is_minor }
        : {}),
      delivery: v.delivery,
      language: v.language,
      hints: v.hints.map(fromFact),
      dialogueLineCount: v.dialogue_line_count,
      sceneRefs: v.scene_refs,
      firstScene: v.scene_refs[0],
      uiSummary: v.ui_summary,
    });
  }

  const kept = new Set(assets.map((a) => a.existing?.id).filter(Boolean));
  const removed = output.diff.removed
    .map((id) => byTemp.get(id))
    .filter((a): a is Asset => a !== undefined && !kept.has(a.id));

  const sceneIndex: DetectionSceneIndexEntry[] = output.scene_index.map((s) => ({
    sceneNumber: s.scene_number,
    heading: s.heading,
    anchor: s.anchor,
    location: nameOf(s.location_id),
    locationState: s.location_state_id === null ? null : localId(s.location_state_id),
    timeOfDay: s.time_of_day,
    characters: namesOf(s.characters_present),
    characterLooks: s.char_looks
      .map((l) => ({ character: nameOf(l.char_id), look: localId(l.look_id) }))
      .filter((l): l is { character: string; look: string } => l.character !== null),
    voices: namesOf(s.voices_heard),
    props: namesOf(s.props_present),
  }));

  const removedRefs = output.diff.removed
    .map((id) => {
      const row = byTemp.get(id);
      return row ? formatAssetRef(row.kind, row.name) : null;
    })
    .filter((r): r is string => r !== null);

  return {
    assets,
    removed,
    sceneIndex,
    diff: {
      added: refsOf(output.diff.added),
      updated: refsOf(output.diff.updated),
      removed: removedRefs,
    },
    assumptions: output.assumptions.map(translate),
    warnings: output.warnings.map(translate),
  };
}

/** Warnings the user sees on the category screens (MINOR_PRESENT is for later damis only). */
export function visibleWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((w) => !/^MINOR_PRESENT:/.test(w));
}

/** Translates `target_ids` written as `kind:Name` refs into the run's temporary ids. */
export function tempIdsFor(refs: readonly string[], tempByName: ReadonlyMap<string, string>) {
  return refs
    .map((ref) => {
      const colon = ref.indexOf(":");
      return tempByName.get(refKey(ref.slice(0, colon), ref.slice(colon + 1))) ?? null;
    })
    .filter((t): t is string => t !== null);
}
