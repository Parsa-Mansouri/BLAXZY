import type { AssetStage, LookView, SheetView } from "@/server/assets";
import type { LookAspectRatio } from "./look-review";

/** The shapes a picture is shown in: the project's orientation, a sheet, or a look's own ratio. */
export type ArtworkShape = "landscape" | "portrait" | "sheet" | LookAspectRatio;

/** What the detail screen needs from `getAssetDetail`, newest first. */
export interface DetailVersions {
  stage: AssetStage;
  busy: boolean;
  looks: LookView[];
  sheets: SheetView[];
}

type LookStatus = LookView["status"];

const STATUS_LABELS: Record<LookStatus, string> = {
  pending: "In Progress",
  in_review: "In Review",
  accepted: "Accepted",
  rejected: "Changes Requested",
  superseded: "Replaced",
  failed: "Failed",
  needs_input: "Question Asked",
};

export const versionStatusLabel = (status: LookStatus) => STATUS_LABELS[status];

export { assetStatusLabel as stageLabel } from "../../../../_lib/asset-status";

/**
 * How a look came to be, in a few words. `parent` is the look it answers (a rejected one it fixes,
 * or one whose question was answered), when known.
 */
export function lookOrigin(look: LookView, parent?: LookView | null): string {
  if (look.source === "uploaded") return "Uploaded";
  if (look.spec?.heroMode === "use_uploaded") return "Your photo, used as the Hero";
  if (parent?.status === "rejected") return "Revised after review";
  if (parent && look.clarifyAnswers) return "After your answer";
  const photos = look.references.length > 0;
  if (look.guidedAnswers) return photos ? "From your answers and photos" : "From your answers";
  if (look.userPrompt) return photos ? "From your description and photos" : "From your description";
  if (photos) return "From your photos";
  if (look.parentId) return "Revised after review";
  return "Designed by BLAXZY";
}

/** The look a look answers, among the listed ones. */
export function parentLook(looks: readonly LookView[], look: LookView): LookView | null {
  return look.parentId ? (looks.find((l) => l.id === look.parentId) ?? null) : null;
}

/**
 * The shape a look is shown in: its own ratio when the designer chose one (character boards and
 * location Heroes are 16:9, props follow their shape), else the project's orientation.
 */
export function lookShape(
  aspectRatio: LookView["aspectRatio"],
  orientation: "landscape" | "portrait",
): ArtworkShape {
  return aspectRatio ?? orientation;
}

/** The image to keep on screen while a new one is produced or after one failed. */
export type HeldImage = {
  fileId: string;
  kind: "look" | "sheet";
  versionNumber: number;
  /** A look's own ratio (see `lookShape`); null for a sheet. */
  aspectRatio: LookView["aspectRatio"];
};

/**
 * While a fix is generating (or after it failed), the version it fixes stays visible. A fix follows
 * a rejected generated look, or a rejected sheet of the same accepted look. While a first sheet is
 * built, the accepted image is shown.
 */
export function heldImage({ stage, looks, sheets }: DetailVersions): HeldImage | null {
  const [look, previousLook] = looks;
  if (!look) return null;
  const lookFailed = stage === "failed" && look.status === "failed";

  if (stage === "generating" || lookFailed) {
    if (
      previousLook?.fileId &&
      previousLook.status === "rejected" &&
      previousLook.source === "generated"
    ) {
      return {
        fileId: previousLook.fileId,
        kind: "look",
        versionNumber: previousLook.versionNumber,
        aspectRatio: previousLook.aspectRatio,
      };
    }
    return null;
  }

  if (stage === "building_sheet" || stage === "failed") {
    const [sheet, previousSheet] = sheets;
    if (
      sheet?.lookId === look.id &&
      previousSheet?.fileId &&
      previousSheet.lookId === look.id &&
      previousSheet.status === "rejected"
    ) {
      return {
        fileId: previousSheet.fileId,
        kind: "sheet",
        versionNumber: previousSheet.versionNumber,
        aspectRatio: null,
      };
    }
    if (look.fileId && look.status === "accepted") {
      return {
        fileId: look.fileId,
        kind: "look",
        versionNumber: look.versionNumber,
        aspectRatio: look.aspectRatio,
      };
    }
  }
  return null;
}

/** The failed look or sheet behind a `failed` stage. */
export function failedVersion({
  stage,
  looks,
  sheets,
}: DetailVersions):
  | { kind: "look"; id: string; failure: string | null }
  | { kind: "sheet"; id: string; failure: string | null }
  | null {
  if (stage !== "failed") return null;
  const look = looks[0];
  if (look?.status === "failed") return { kind: "look", id: look.id, failure: look.failure };
  const sheet = sheets[0];
  if (sheet?.status === "failed") return { kind: "sheet", id: sheet.id, failure: sheet.failure };
  return null;
}

/** True for the failure the worker writes when the balance was too low. */
export function isCreditsFailure(failure: string | null): boolean {
  return failure !== null && /\bcredits?\b/i.test(failure);
}

/** The accepted look of the asset (its latest look once accepted). */
export function acceptedLook(looks: LookView[]): LookView | null {
  const look = looks[0];
  return look?.status === "accepted" ? look : null;
}

/** A short fingerprint of the state, compared by the poller to decide when to refresh. */
export function versionsKey({ stage, busy, looks, sheets }: DetailVersions): string {
  const look = looks[0];
  const sheet = sheets[0];
  return [
    stage,
    busy ? "busy" : "idle",
    look ? `${look.id}:${look.status}` : "-",
    sheet ? `${sheet.id}:${sheet.status}` : "-",
  ].join("|");
}

export type HistoryItem =
  | { kind: "look"; key: string; version: LookView }
  | { kind: "sheet"; key: string; version: SheetView };

/** Looks and sheets in one list, newest first. */
export function historyItems(looks: LookView[], sheets: SheetView[]): HistoryItem[] {
  const items: HistoryItem[] = [
    ...looks.map((version) => ({ kind: "look" as const, key: `look:${version.id}`, version })),
    ...sheets.map((version) => ({ kind: "sheet" as const, key: `sheet:${version.id}`, version })),
  ];
  return items.sort(
    (a, b) => new Date(b.version.createdAt).getTime() - new Date(a.version.createdAt).getTime(),
  );
}

/** The slug of a kind in the category route: `costume` → `costume`, `some_kind` → `some-kind`. */
export const kindSlug = (kind: string) => kind.replaceAll("_", "-");
