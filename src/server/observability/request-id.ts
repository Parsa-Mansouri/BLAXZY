/**
 * Request ids: one per request, server action and route handler, so a user's "Reference" and the
 * log lines and tracker events of that request can be matched. Pure (no Node-only imports): the
 * proxy imports it.
 */

/** The header that carries the id (set by the proxy; a reverse proxy may send its own). */
export const REQUEST_ID_HEADER = "x-request-id";

/** Letters, digits and `-_.:`, 8 to 128 characters: what an incoming id may look like. */
const WELL_FORMED = /^[A-Za-z0-9._:-]{8,128}$/;

/** True for an id we accept from a client or a reverse proxy. */
export function isWellFormedRequestId(value: unknown): value is string {
  return typeof value === "string" && WELL_FORMED.test(value);
}

/** The incoming id when it is well formed, else a new random one. */
export function requestIdFrom(incoming: string | null | undefined): string {
  return isWellFormedRequestId(incoming) ? incoming : crypto.randomUUID();
}

/** The short reference a user can quote: the id's first 8 characters (searchable in the logs). */
export function shortReference(requestId: string): string {
  return requestId.slice(0, 8);
}
