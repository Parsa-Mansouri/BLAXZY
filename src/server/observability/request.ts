/**
 * Entering a request scope from a server action or a route handler: the id the proxy put on the
 * request (`x-request-id`), or a new one when there is none (a request the proxy did not match,
 * a test). Nested calls keep the scope they are already in.
 */
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, requestIdFrom } from "./request-id";
import { currentRequestId, withRequestScope } from "./scope";

/** Runs `fn` in the scope of the current request; `source`: the request's headers, if at hand. */
export async function inRequestScope<T>(
  fn: () => Promise<T>,
  source?: { get(name: string): string | null },
): Promise<T> {
  if (currentRequestId() !== undefined) return await fn();
  let incoming: string | null = null;
  try {
    incoming = (source ?? (await headers())).get(REQUEST_ID_HEADER);
  } catch {
    // Outside a request (a test or a script): a new id.
  }
  return await withRequestScope(requestIdFrom(incoming), fn);
}
