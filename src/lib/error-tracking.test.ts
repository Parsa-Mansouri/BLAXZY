import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, stripQuery } from "./error-tracking";

describe("scrubEvent", () => {
  it("keeps the user id only, and no cookies, bodies, queries or identifying headers", () => {
    const event = scrubEvent({
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" } as { id: string },
      request: {
        url: "https://blaxzy.com/reset-password?token=secret#x",
        query_string: "token=secret",
        cookies: { "blaxzy.session_token": "s" },
        data: { password: "p" },
        headers: {
          "x-request-id": "r1",
          "User-Agent": "UA",
          cookie: "c",
          "x-forwarded-for": "1.2.3.4",
          authorization: "Bearer t",
        },
      },
      extra: { email: "a@b.c", projectId: "p1", next: "https://blaxzy.com/x?token=1" },
    });
    expect(event.user).toEqual({ id: "u1" });
    expect(event.request).toEqual({
      url: "https://blaxzy.com/reset-password",
      headers: { "x-request-id": "r1", "User-Agent": "UA" },
    });
    expect(event.extra).toEqual({ projectId: "p1", next: "https://blaxzy.com/x" });
  });

  it("drops a user without an id", () => {
    expect(scrubEvent({ user: { ip_address: "1.2.3.4" } as object }).user).toBeUndefined();
  });

  it("cuts queries from breadcrumb URLs", () => {
    expect(
      scrubBreadcrumb({ data: { from: "/a?x=1", to: "/reset-password?token=t", url: "/b#c" } })
        .data,
    ).toEqual({ from: "/a", to: "/reset-password", url: "/b" });
  });

  it("strips query and fragment", () => {
    expect(stripQuery("/p?q=1")).toBe("/p");
    expect(stripQuery("/p#f")).toBe("/p");
    expect(stripQuery("/p")).toBe("/p");
  });
});
