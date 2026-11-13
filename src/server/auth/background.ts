import { errorMessage, logLine } from "@/server/jobs/log";

type AfterFn = (task: Promise<unknown>) => void;

let afterLoader: Promise<AfterFn | null> | undefined;

/**
 * Next's `after()`, loaded on first use rather than at module top level: this module is also
 * imported outside Next (scripts, tests), where `next/server` must not be required eagerly.
 */
function loadAfter(): Promise<AfterFn | null> {
  afterLoader ??= import("next/server").then(
    (mod): AfterFn => mod.after,
    () => null,
  );
  return afterLoader;
}

/**
 * Keeps the process working on `task` after the response has been sent: registered with
 * `after()` inside a Next request, otherwise left detached. `task` must never reject (callers
 * attach their own catch).
 */
export function keepAlive(task: Promise<unknown>): void {
  void loadAfter().then((after) => {
    if (!after) return;
    try {
      after(task);
    } catch {
      // Outside a request scope (a script, a test): the task simply runs detached.
    }
  });
}

/**
 * Starts sending an auth email without waiting for it, so the response time (and a mail-server
 * failure) never shows whether an account exists. Failures are logged without the message, the
 * link or its token. `send` is called synchronously.
 */
export function sendInBackground(kind: string, send: () => Promise<void>): void {
  let sending: Promise<void>;
  try {
    sending = send();
  } catch (error) {
    sending = Promise.reject(error);
  }
  keepAlive(
    sending.catch((error: unknown) => {
      logLine("error", "auth email failed", { kind, error: errorMessage(error) });
    }),
  );
}
