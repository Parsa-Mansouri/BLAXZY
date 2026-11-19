import { forwardBrowserEnvelope } from "@/server/observability/tunnel";

/** The browser's error reports, forwarded to GlitchTip (see `forwardBrowserEnvelope`). */
export async function POST(request: Request): Promise<Response> {
  return await forwardBrowserEnvelope(request);
}
