/**
 * One-line notices for a redirect inside a project: the page that redirects adds `?notice=<key>`
 * and the project layout shows the line once, then takes the flag out of the address. No server
 * imports, so pages and client components share it.
 */
export const NOTICE_FLAG = "notice";

export const ROUTE_NOTICES = {
  "not-finished": "The film is not finished yet. No clip is final.",
  "review-complete": "Every shot is reviewed. Their clips are here.",
  "film-finished": "The film is finished. Every clip is here.",
  "shot-has-clip": "This shot is approved. Its clip is made here.",
} as const;

export type RouteNoticeKey = keyof typeof ROUTE_NOTICES;

export function routeNotice(key: string | null): string | null {
  return key !== null && key in ROUTE_NOTICES ? ROUTE_NOTICES[key as RouteNoticeKey] : null;
}
