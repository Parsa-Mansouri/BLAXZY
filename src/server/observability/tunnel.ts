/**
 * The browser's error reports reach GlitchTip through this server (`POST /api/monitoring`), so
 * the Content-Security-Policy stays `connect-src 'self'` and ad blockers do not drop them. Only
 * envelopes for our own DSNs are forwarded (never the request's headers or cookies); with
 * tracking off the route does not exist (404).
 */
import { getTrackingEnv } from "@/server/env";

/** The SDK sends small envelopes; anything bigger is refused before it is read. */
const MAX_ENVELOPE_BYTES = 1_000_000;

export async function forwardBrowserEnvelope(request: Request): Promise<Response> {
  const env = getTrackingEnv();
  const allowedDsns = [env.SENTRY_DSN, env.NEXT_PUBLIC_SENTRY_DSN].filter(
    (dsn): dsn is string => dsn !== undefined,
  );
  if (!env.SENTRY_DSN || allowedDsns.length === 0) return new Response(null, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 });
  }
  const { createSentryTunnelRoute } = await import("@sentry/nextjs/tunnel");
  return await createSentryTunnelRoute({ allowedDsns }).POST(request);
}
