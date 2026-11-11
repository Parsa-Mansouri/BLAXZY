import type { AssetStage, LookView, SheetView } from "@/server/assets";

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
};

export const versionStatusLabel = (status: LookStatus) => STATUS_LABELS[status];

const STAGE_LABELS: Record<AssetStage, string> = {
  needs_image: "Needs an Image",
  needs_recording: "Needs a Recording",
  generating: "Creating the Image",
  look_review: "Image to Review",
  building_sheet: "Building the Sheet",
  sheet_review: "Sheet to Review",
  ready: "Ready",
  failed: "Needs Attention",
};

export const stageLabel = (stage: AssetStage) => STAGE_LABELS[stage];

/** How a look came to be, in a few words. */
export function lookOrigin(look: LookView): string {
  if (look.source === "uploaded") return "Uploaded";
  if (look.guidedAnswers) return "From your answers";
  if (look.userPrompt) return "From your description";
  return "Revised after review";
}

/** The image to keep on screen while a new one is produced or after one failed. */
export type HeldImage = { fileId: string; kind: "look" | "sheet"; versionNumber: number };

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
      };
    }
    if (look.fileId && look.status === "accepted") {
      return { fileId: look.fileId, kind: "look", versionNumber: look.versionNumber };
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
