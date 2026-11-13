/**
 * The one wrapper every `GET /api/poll/**` handler goes through. It mirrors `pollAction`
 * (src/app/(app)/_lib/action.ts), so a polled read behaves the same as a server action did, but
 * it is a plain GET: Next runs server actions one at a time per client, and polls queued behind
 * (and in front of) the user's own clicks.
 *
 * - Never redirects: no session or an unverified email is a 401, so a background tab is not sent
 *   to the sign-in page (the browser-side client treats it as "no answer").
 * - The `poll` rate limit: 429 with Retry-After (503 with Retry-After when the counter is down).
 * - A handler calls `badRequest()` for a malformed id or query: 400.
 * - A user-facing service error is a 400 and an unexpected one is logged and answered 500 with an
 *   empty JSON body. Error text never reaches the answer.
 * - Every answer is `Cache-Control: no-store` JSON with `X-Content-Type-Options: nosniff`. The
 *   route files also export `dynamic = "force-dynamic"`: Route Handlers are not cached by default
 *   (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md, "Caching"),
 *   and this makes it explicit.
 */
import { NextResponse } from "next/server";
import { clampCount, isUuid, logActionError, userMessage } from "@/app/(app)/_lib/action";
import { getSession, type AuthUser } from "@/server/auth";
import { checkRateLimit } from "@/server/ratelimit";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/** Thrown by `badRequest()`; answered as a 400. */
export class PollBadRequest extends Error {
  constructor() {
    super("bad poll request");
    this.name = "PollBadRequest";
  }
}

/** Ends the handler with a 400 (a malformed path or query parameter). */
export function badRequest(): never {
  throw new PollBadRequest();
}

/** A path parameter that must be a UUID (a 400 otherwise). */
export function uuidParam(value: unknown): string {
  return isUuid(value) ? value : badRequest();
}

/** An optional query parameter that must be a UUID when present (null when absent or empty). */
export function optionalUuid(query: URLSearchParams, name: string): string | null {
  const raw = query.get(name);
  if (raw === null || raw === "") return null;
  return uuidParam(raw);
}

/**
 * A count from the query (how many items the screen shows), clamped to `[min, max]` like the
 * actions did. Absent reads as `min`; text that is not a number is a 400.
 */
export function countParam(query: URLSearchParams, name: string, min: number, max: number): number {
  const raw = query.get(name);
  if (raw === null || raw === "") return min;
  const n = Number(raw);
  if (!Number.isFinite(n)) return badRequest();
  return clampCount(n, min, max);
}

export interface PollContext<P> {
  user: AuthUser;
  /** The route's path parameters (as the file name gives them; validate them). */
  params: P;
  query: URLSearchParams;
}

type RouteParams = Record<string, string>;

function json(status: number, body: unknown, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...HEADERS, ...extra } });
}

/**
 * Builds the `GET` export of a poll route. `handler` returns the payload the action used to
 * return (anything JSON-serializable, `null` included).
 */
export function pollRoute<P extends RouteParams = RouteParams>(
  tag: string,
  handler: (context: PollContext<P>) => Promise<unknown>,
) {
  return async function GET(
    request: Request,
    context: { params: Promise<P> },
  ): Promise<NextResponse> {
    let user: AuthUser;
    try {
      const session = await getSession();
      if (!session?.user.emailVerified) return json(401, { error: "signed_out" });
      user = session.user;
    } catch (error) {
      logActionError(tag, error);
      return json(500, {});
    }
    try {
      const limit = await checkRateLimit({ userId: user.id, bucket: "poll" });
      if (!limit.ok) {
        return json(
          limit.reason === "limited" ? 429 : 503,
          { error: limit.reason },
          { "Retry-After": String(limit.retryAfterSeconds) },
        );
      }
      const params = await context.params;
      const query = new URL(request.url).searchParams;
      return json(200, await handler({ user, params, query }));
    } catch (error) {
      // A user-facing service error is the caller's mistake (a stale or foreign id): no text.
      if (error instanceof PollBadRequest || userMessage(error) !== null) {
        return json(400, { error: "bad_request" });
      }
      logActionError(tag, error);
      return json(500, {});
    }
  };
}
