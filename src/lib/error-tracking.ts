/**
 * Privacy rules for error-tracking events, shared by the server, the worker and the browser.
 * Pure, no SDK import: the SDKs call these from `beforeSend` / `beforeBreadcrumb`.
 *
 * No PII leaves the app: the user is reduced to its id (no email, name or IP address), cookies,
 * request bodies and most headers are dropped, query strings (which can carry reset tokens) are
 * cut from every URL, and fields whose names look sensitive are removed.
 */

/** The parts of an SDK event this module rewrites (structural, so any SDK's event type fits). */
export type ScrubbableEvent = {
  user?: { id?: string | number } | null;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
};

export type ScrubbableBreadcrumb = {
  message?: string;
  data?: Record<string, unknown>;
};

const SENSITIVE_KEY =
  /e-?mail|password|passwd|token|secret|cookie|authorization|api[-_]?key|credential|^ip$|ip_?address/i;

/** Request headers kept on an event (the rest can identify a person or carry credentials). */
const KEPT_HEADERS = new Set(["x-request-id", "user-agent", "content-type"]);

/** `url` without its query string and fragment. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** `fields` without the keys whose names look sensitive (one level deep is enough for logs). */
export function scrubFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] =
      typeof value === "string" && /^https?:\/\//.test(value) ? stripQuery(value) : value;
  }
  return result;
}

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(original: B): B {
  const breadcrumb: ScrubbableBreadcrumb = original;
  if (breadcrumb.data) breadcrumb.data = scrubFields(breadcrumb.data);
  for (const key of ["url", "from", "to"] as const) {
    const value = breadcrumb.data?.[key];
    if (typeof value === "string" && breadcrumb.data) breadcrumb.data[key] = stripQuery(value);
  }
  return original;
}

export function scrubEvent<E extends ScrubbableEvent>(original: E): E {
  const event: ScrubbableEvent = original;
  if (event.user) {
    const id = event.user.id;
    event.user = id === undefined ? undefined : { id };
  }
  if (event.request) {
    const request = event.request;
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    if (typeof request.url === "string") request.url = stripQuery(request.url);
    if (request.headers) {
      const kept: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (KEPT_HEADERS.has(name.toLowerCase())) kept[name] = value;
      }
      request.headers = kept;
    }
  }
  if (event.extra) event.extra = scrubFields(event.extra);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b));
  return original;
}

/**
 * The SDK's `dataCollection` option (v11 replaced `sendDefaultPii`): collect no user info,
 * cookies, query strings, bodies, local variables or payloads; of the headers only the request id,
 * user agent and content type. `scrubEvent` then enforces the same rules on whatever remains.
 */
export function minimalDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: [...KEPT_HEADERS] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  };
}
