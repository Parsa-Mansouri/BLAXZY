/**
 * The browser side of `GET /api/poll/**`: one typed function per polled read. Each returns what
 * the server action it replaced returned, or that action's quiet value when there is no answer:
 * `null` for the fingerprint/status polls, `{ ok: false, error }` for the ones that answered an
 * `ActionResult`.
 *
 * "No answer" is anything but a 2xx JSON body: a redirect to /login (signed out; `redirect:
 * "manual"` keeps `fetch` from following it and receiving HTML), 401, 429, any other status, a
 * non-JSON body, a body of the wrong shape, a network error or an abort. A poll never throws and
 * never redirects. Server actions kept the quiet value too, so screens read it the same way.
 *
 * Plain module (no server imports at run time): only types come from the server side.
 */
import type { FinishedAssetEvent, FinishedFeedPage } from "@/server/assets";
import type { ExportView } from "@/server/production";
import type { BackgroundStatus } from "@/app/(app)/projects/[id]/_lib/background-status";
import type { CardsPage } from "@/app/(app)/projects/[id]/pre-production/[kind]/_lib/read-cards";
import type { BlocksSnapshot } from "@/app/(app)/projects/[id]/production/blocks/_lib/read-snapshot";
import type { BoardPage } from "@/app/(app)/projects/[id]/production/clips/_lib/clip-data";
import type { ScriptPoll } from "@/app/(app)/projects/[id]/script/_lib/script-poll";
import type { ClientDetectionPanel } from "@/app/(app)/projects/[id]/pre-production/[kind]/_components/category-panel";
import { SERVER_PROBLEM, SIGNED_OUT, TOO_MANY_REQUESTS } from "./messages";

export type QuietReason = "signed_out" | "limited" | "failed";

export interface PollOptions {
  /** Aborts the request (the screen was left, or the poll was switched off). */
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetcher?: typeof fetch;
}

type ActionFailure = { ok: false; error: string };
type ActionResult<T> = { ok: true; data: T } | ActionFailure;

const MESSAGES: Record<QuietReason, string> = {
  signed_out: SIGNED_OUT,
  limited: TOO_MANY_REQUESTS,
  failed: SERVER_PROBLEM,
};

type Answer = { answered: true; body: unknown } | { answered: false; reason: QuietReason };

/** One GET; never throws. */
export async function getPoll(
  path: string,
  { signal, fetcher = fetch }: PollOptions = {},
): Promise<Answer> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    return { answered: false, reason: "failed" };
  }
  // A manual redirect shows up as an opaque-redirect response (the proxy sends a signed-out
  // request to /login). Either way the status is not 2xx.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return { answered: false, reason: "signed_out" };
  }
  if (response.status === 401) return { answered: false, reason: "signed_out" };
  if (response.status === 429) return { answered: false, reason: "limited" };
  if (!response.ok) return { answered: false, reason: "failed" };
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { answered: false, reason: "failed" };
  }
  try {
    return { answered: true, body: await response.json() };
  } catch {
    return { answered: false, reason: "failed" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFingerprint = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const isRecordOrNull = (value: unknown): boolean => value === null || isRecord(value);
const isActionResult = (value: unknown): boolean =>
  isRecord(value) &&
  ((value.ok === true && "data" in value) ||
    (value.ok === false && typeof value.error === "string"));

/** A poll whose quiet value is `null`. */
async function pollOrNull<T>(
  path: string,
  options: PollOptions | undefined,
  valid: (value: unknown) => boolean,
): Promise<T | null> {
  const answer = await getPoll(path, options);
  if (!answer.answered || !valid(answer.body)) return null;
  return answer.body as T | null;
}

/** A poll whose quiet value is `{ ok: false, error }`. */
async function pollResult<T>(
  path: string,
  options: PollOptions | undefined,
): Promise<ActionResult<T>> {
  const answer = await getPoll(path, options);
  if (!answer.answered) return { ok: false, error: MESSAGES[answer.reason] };
  if (!isActionResult(answer.body)) return { ok: false, error: MESSAGES.failed };
  return answer.body as ActionResult<T>;
}

const seg = encodeURIComponent;
const project = (id: string) => `/api/poll/projects/${seg(id)}`;

/** Sectioning state and block count (null: nothing to report). */
export function pollPreProduction(projectId: string, options?: PollOptions) {
  return pollOrNull<{ state: string; blockCount: number }>(
    `${project(projectId)}/pre-production/status`,
    options,
    isRecordOrNull,
  );
}

/** Whether pre-production work is running and a signature of what the overview shows. */
export function pollOverview(projectId: string, options?: PollOptions) {
  return pollOrNull<{ busy: boolean; signature: string }>(
    `${project(projectId)}/pre-production/overview`,
    options,
    isRecordOrNull,
  );
}

/** The latest script version and its status. */
export function pollScript(projectId: string, options?: PollOptions) {
  return pollOrNull<ScriptPoll>(`${project(projectId)}/script`, options, isRecordOrNull);
}

/** Detection and sectioning status of the accepted script. */
export function pollBackgroundStatus(
  projectId: string,
  acceptedVersionId: string | null,
  options?: PollOptions,
) {
  const query = acceptedVersionId === null ? "" : `?accepted=${seg(acceptedVersionId)}`;
  return pollOrNull<BackgroundStatus>(
    `${project(projectId)}/background-status${query}`,
    options,
    isRecordOrNull,
  );
}

/** A fingerprint of an asset's state. */
export function pollAsset(assetId: string, options?: PollOptions) {
  return pollOrNull<string>(`/api/poll/assets/${seg(assetId)}`, options, isFingerprint);
}

/** A fingerprint of a shot's state in the pre-production blocks. */
export function pollBlock(lineageId: string, options?: PollOptions) {
  return pollOrNull<string>(`/api/poll/blocks/${seg(lineageId)}`, options, isFingerprint);
}

/** A fingerprint of a shot's state on the clip page. */
export function pollClip(lineageId: string, options?: PollOptions) {
  return pollOrNull<string>(`/api/poll/clips/${seg(lineageId)}`, options, isFingerprint);
}

/** The first `count` assets of a category again. */
export function refreshCards(
  projectId: string,
  kind: string,
  count: number,
  options?: PollOptions,
) {
  return pollResult<CardsPage>(
    `${project(projectId)}/pre-production/categories/${seg(kind)}/cards?count=${Math.trunc(count)}`,
    options,
  );
}

/** The detected list's review panel (client-safe options). */
export function pollDetectionPanel(projectId: string, options?: PollOptions) {
  return pollResult<ClientDetectionPanel>(
    `${project(projectId)}/pre-production/detection-panel`,
    options,
  );
}

/** The first `count` shots again with the counts. */
export function refreshBlocks(projectId: string, count: number, options?: PollOptions) {
  return pollResult<BlocksSnapshot>(
    `${project(projectId)}/blocks?count=${Math.trunc(count)}`,
    options,
  );
}

/** The first `count` clip tiles again with the status counts. */
export function refreshBoard(projectId: string, count: number, options?: PollOptions) {
  return pollResult<BoardPage>(
    `${project(projectId)}/clips-board?count=${Math.trunc(count)}`,
    options,
  );
}

/** The state of a ZIP export. */
export function pollExport(exportId: string, options?: PollOptions) {
  return pollResult<ExportView>(`/api/poll/exports/${seg(exportId)}`, options);
}

/** The feed as JSON carries `createdAt` as an ISO string (the action kept the `Date`). */
type WireFinishedEvent = Omit<FinishedAssetEvent, "createdAt"> & { createdAt: string };

function revive(event: WireFinishedEvent): FinishedAssetEvent | null {
  const createdAt = new Date(event.createdAt);
  return Number.isNaN(createdAt.getTime()) ? null : { ...event, createdAt };
}

/** Assets finished since `cursor` (null cursor: only where to start). Dates are revived here. */
export async function pollFinished(
  cursor: string | null,
  options?: PollOptions,
): Promise<FinishedFeedPage | null> {
  const query = cursor === null ? "" : `?cursor=${seg(cursor)}`;
  const answer = await getPoll(`/api/poll/finished${query}`, options);
  if (!answer.answered) return null;
  const body = answer.body;
  if (!isRecord(body) || typeof body.cursor !== "string" || !Array.isArray(body.events)) {
    return null;
  }
  const events: FinishedAssetEvent[] = [];
  for (const raw of body.events as WireFinishedEvent[]) {
    const event = isRecord(raw) ? revive(raw) : null;
    if (!event) return null;
    events.push(event);
  }
  return { events, cursor: body.cursor };
}
