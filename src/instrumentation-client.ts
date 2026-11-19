// Runs before hydration (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// instrumentation-client.md). Error tracking starts only when NEXT_PUBLIC_SENTRY_DSN was set at
// build time; the SDK itself loads asynchronously, after this file.
import { startBrowserTracking } from "@/lib/browser-tracking";

startBrowserTracking();
