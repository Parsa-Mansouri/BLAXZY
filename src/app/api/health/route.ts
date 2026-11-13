import { isDatabaseHealthy } from "@/server/health";

/** Liveness/readiness probe: never cached, never static, no details in the body. */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export async function GET(): Promise<Response> {
  const ok = await isDatabaseHealthy();
  return Response.json(
    { status: ok ? "ok" : "unavailable" },
    { status: ok ? 200 : 503, headers: HEADERS },
  );
}
