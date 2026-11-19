import { checkReadiness } from "@/server/health";

/**
 * Readiness probe: the database, the bucket, the job queue and the worker heartbeat. 503 when the
 * database, the bucket or the queue is unavailable; 200 `degraded` when only the worker is down.
 * Never cached, never static; the body names checks and states only, never a reason.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export async function GET(): Promise<Response> {
  const readiness = await checkReadiness();
  return Response.json(readiness, {
    status: readiness.status === "unavailable" ? 503 : 200,
    headers: HEADERS,
  });
}
