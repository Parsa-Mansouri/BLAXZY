/** Liveness probe: the process answers. Checks no dependency (see `/api/health` for readiness). */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export function GET(): Response {
  return Response.json({ status: "ok" }, { status: 200, headers: HEADERS });
}
