import type { Instrumentation } from "next";

/**
 * Server instrumentation (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * instrumentation.md). Error tracking runs in the Node.js runtime only; the proxy (the only edge
 * code) does no reporting. Everything is loaded lazily so the edge bundle stays free of it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWebTracking } = await import("@/server/observability/web");
  await startWebTracking();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logRequestError } = await import("@/server/observability/web");
  logRequestError(error, request, context);
};
