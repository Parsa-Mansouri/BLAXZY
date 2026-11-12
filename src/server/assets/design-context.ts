/**
 * What a designer reads besides the asset itself (worker only): the script slice where the asset
 * appears (from the latest detection's scene index and the accepted script's text), the names of
 * the project's characters and props (a location never draws them), the characters who handle a
 * prop and the approved Heroes of the locations it stands in.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  designerFor,
  flattenForDetector,
  isSceneHeading,
  nameKey,
  parseStoredScreenplay,
  type DesignerScene,
  type DesignerScript,
} from "@/server/damis";
import { getDb } from "@/server/db/client";
import {
  asset,
  assetDetection,
  assetLook,
  scriptVersion,
  type AssetFact,
  type DetectionSceneIndexEntry,
} from "@/server/db/schema";
import type { AssetRow } from "./looks";

/** Scenes sent to a designer at most, and how much of each. */
const MAX_SCENES = 12;
const MAX_SCENE_TEXT = 2500;
const MAX_EXCLUDED = 300;

export type LinkedCharacter = {
  name: string;
  ageGroup: string;
  build: string;
  handedness: string;
  usageNote: string;
};

export type LinkedLocation = {
  name: string;
  summary: string;
  /** The approved location's anchor that is this prop, as "name (where)", else null. */
  anchor: string | null;
  /** The approved Hero, attached so the prop can match it. */
  heroFileId: string | null;
};

export type DesignContext = {
  script: DesignerScript;
  /** Characters and props of the project (a location never draws them). */
  excludeAssets: string[];
  linkedCharacters: LinkedCharacter[];
  linkedLocations: LinkedLocation[];
};

type SceneText = { number: string; heading: string; text: string };

function rawScenes(text: string): SceneText[] {
  const scenes: { heading: string; body: string[] }[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (isSceneHeading(line)) scenes.push({ heading: line.trim(), body: [] });
    else if (scenes.length === 0) scenes.push({ heading: "", body: [line] });
    else scenes[scenes.length - 1]?.body.push(line);
  }
  return scenes.map((s, i) => ({
    number: String(i + 1),
    heading: s.heading,
    text: s.body.join("\n").trim(),
  }));
}

function appearsIn(row: AssetRow, scene: DetectionSceneIndexEntry): boolean {
  const key = nameKey(row.name);
  switch (designerFor(row.kind)) {
    case "character":
      return scene.characters.some((c) => nameKey(c) === key);
    case "location":
      return scene.location !== null && nameKey(scene.location) === key;
    case "prop":
      return scene.props.some((p) => nameKey(p) === key);
    case null:
      return false;
  }
}

/** The script slice of an asset: the scenes it appears in (at most twelve), with their text. */
async function scriptSlice(row: AssetRow): Promise<DesignerScript> {
  const db = getDb();
  const [latest] = await db
    .select({ sceneIndex: assetDetection.sceneIndex, versionId: assetDetection.scriptVersionId })
    .from(assetDetection)
    .where(eq(assetDetection.projectId, row.projectId))
    .orderBy(desc(assetDetection.createdAt))
    .limit(1);
  const versionId = latest?.versionId ?? row.lastScriptVersionId;
  if (!versionId) return { logline: "", scenes: [] };
  const [version] = await db
    .select({ content: scriptVersion.content, screenplay: scriptVersion.screenplay })
    .from(scriptVersion)
    .where(eq(scriptVersion.id, versionId))
    .limit(1);
  if (!version) return { logline: "", scenes: [] };
  const stored = parseStoredScreenplay(version.screenplay);
  const texts: SceneText[] = stored
    ? flattenForDetector(stored).map((s) => ({
        number: s.scene_number,
        heading: s.heading,
        text: s.text,
      }))
    : rawScenes(version.content ?? "");
  const index = latest?.sceneIndex ?? [];
  const wanted = new Set(
    index.length > 0
      ? index.filter((s) => appearsIn(row, s)).map((s) => s.sceneNumber)
      : (row.details?.sceneRefs ?? []),
  );
  const byNumber = new Map(index.map((s) => [s.sceneNumber, s]));
  const scenes: DesignerScene[] = texts
    .filter((t) => wanted.has(t.number))
    .slice(0, MAX_SCENES)
    .map((t) => ({
      sceneNumber: t.number.slice(0, 20),
      heading: t.heading.slice(0, 300),
      action: t.text.slice(0, MAX_SCENE_TEXT),
      dialogueExcerpt: "",
      charactersPresent: (byNumber.get(t.number)?.characters ?? []).slice(0, 100),
    }));
  return { logline: (stored?.screenplay.logline ?? "").slice(0, 1000), scenes };
}

function fact(facts: readonly AssetFact[] | undefined, pattern: RegExp): string | null {
  return facts?.find((f) => pattern.test(f.field) && f.value.trim())?.value.trim() ?? null;
}

/** Everything a designer needs about the rest of the project for this asset. */
export async function loadDesignContext(row: AssetRow): Promise<DesignContext> {
  const db = getDb();
  const designer = designerFor(row.kind);
  const script = await scriptSlice(row);
  const excludeAssets =
    designer === "location"
      ? (
          await db
            .select({ name: asset.name })
            .from(asset)
            .where(
              and(
                eq(asset.projectId, row.projectId),
                eq(asset.status, "active"),
                inArray(asset.kind, ["character", "prop", "creature", "costume", "other"]),
              ),
            )
            .orderBy(asc(asset.displayOrder))
            .limit(MAX_EXCLUDED)
        ).map((a) => a.name)
      : [];
  if (designer !== "prop") {
    return { script, excludeAssets, linkedCharacters: [], linkedLocations: [] };
  }
  const named = async (kind: "character" | "location", names: readonly string[]) => {
    const keys = [...new Set(names.map(nameKey))];
    if (keys.length === 0) return [];
    return db
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.projectId, row.projectId),
          eq(asset.kind, kind),
          eq(asset.status, "active"),
          inArray(sql`lower(${asset.name})`, keys),
        ),
      )
      .limit(20);
  };
  const characters = await named("character", row.details?.users ?? []);
  const locations = await named("location", row.details?.locationIds ?? []);
  const accepted = async (ids: string[]) =>
    ids.length === 0
      ? new Map<string, typeof assetLook.$inferSelect>()
      : new Map(
          (
            await db
              .select()
              .from(assetLook)
              .where(and(inArray(assetLook.assetId, ids), eq(assetLook.status, "accepted")))
          ).map((l) => [l.assetId, l]),
        );
  const characterLooks = await accepted(characters.map((c) => c.id));
  const locationLooks = await accepted(locations.map((l) => l.id));

  const linkedCharacters = characters.map((c): LinkedCharacter => {
    const answers = characterLooks.get(c.id)?.guidedAnswers ?? {};
    const facts = c.details?.facts;
    return {
      name: c.name,
      ageGroup: answers.age ?? fact(facts, /\bage\b/i) ?? "unknown",
      build: answers.body ?? fact(facts, /\b(build|body|height)\b/i) ?? "unknown",
      handedness: fact(facts, /hand/i) ?? "unknown",
      usageNote: (c.description ?? "").slice(0, 300),
    };
  });
  const propKey = nameKey(row.name);
  const linkedLocations = locations.map((l): LinkedLocation => {
    const look = locationLooks.get(l.id);
    const output = look?.spec?.output;
    const dna =
      output && typeof output === "object" && "dna" in output ? (output.dna as unknown) : null;
    const anchors =
      dna && typeof dna === "object" && "fixed_anchors" in dna && Array.isArray(dna.fixed_anchors)
        ? (dna.fixed_anchors as unknown[])
        : [];
    const anchor = anchors.find(
      (a): a is { name: string; where: string } =>
        typeof a === "object" &&
        a !== null &&
        "name" in a &&
        typeof a.name === "string" &&
        "where" in a &&
        typeof a.where === "string" &&
        (nameKey(a.name).includes(propKey) || propKey.includes(nameKey(a.name))),
    );
    return {
      name: l.name,
      summary: (look?.spec?.summary ?? l.description ?? "").slice(0, 1000),
      anchor: anchor ? `${anchor.name} (${anchor.where})`.slice(0, 500) : null,
      heroFileId: look?.fileId ?? null,
    };
  });
  return { script, excludeAssets, linkedCharacters, linkedLocations };
}
