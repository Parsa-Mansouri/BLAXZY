import { describe, expect, it, vi } from "vitest";
import {
  pollAsset,
  pollBackgroundStatus,
  pollExport,
  pollFinished,
  pollScript,
  refreshBlocks,
} from "./poll-client";
import { SERVER_PROBLEM, SIGNED_OUT, TOO_MANY_REQUESTS } from "./messages";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const fetching = (response: Response | Error) =>
  vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });

const ID = "7f9c2a1e-3b4d-4c5e-8f60-123456789abc";

describe("request", () => {
  it("is a same-origin, uncached GET that does not follow redirects", async () => {
    const fetcher = fetching(json("key"));
    const controller = new AbortController();
    await pollAsset(ID, { fetcher, signal: controller.signal });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`/api/poll/assets/${ID}`);
    expect(init).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  });

  it("encodes path segments and the query", async () => {
    const fetcher = fetching(json(null));
    await pollBackgroundStatus("a/b", "x y", { fetcher });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/poll/projects/a%2Fb/background-status?accepted=x%20y",
    );
    await pollBackgroundStatus(ID, null, { fetcher });
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/poll/projects/${ID}/background-status`);
  });
});

describe("answers", () => {
  it("returns the payload of a 200 JSON answer, null included", async () => {
    expect(await pollAsset(ID, { fetcher: fetching(json("key-1")) })).toBe("key-1");
    expect(await pollAsset(ID, { fetcher: fetching(json(null)) })).toBeNull();
    const poll = { versionId: ID, status: "pending", title: "Salt" };
    expect(await pollScript(ID, { fetcher: fetching(json(poll)) })).toEqual(poll);
    const result = { ok: true, data: { id: "e", status: "working" } };
    expect(await pollExport(ID, { fetcher: fetching(json(result)) })).toEqual(result);
  });

  it("returns an ActionResult failure as it came", async () => {
    const failure = { ok: false, error: "This film is no longer available. Reload the page." };
    expect(await pollExport(ID, { fetcher: fetching(json(failure)) })).toEqual(failure);
  });
});

describe("quiet handling", () => {
  const redirect = () => {
    // A browser gives a manual redirect type "opaqueredirect" and status 0; the Response
    // constructor cannot make one, so the object is built by hand.
    return { type: "opaqueredirect", status: 0, ok: false, headers: new Headers() } as Response;
  };

  it("null-quiet polls answer null for a redirect, 401, 429, 500, HTML, bad JSON, network error", async () => {
    const cases: (Response | Error)[] = [
      redirect(),
      new Response(null, { status: 307, headers: { Location: "/login" } }),
      json({}, { status: 401 }),
      json(
        {},
        { status: 429, headers: { "Retry-After": "3", "Content-Type": "application/json" } },
      ),
      json({}, { status: 500 }),
      new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      new Response("{nope", { status: 200, headers: { "Content-Type": "application/json" } }),
      new TypeError("Failed to fetch"),
    ];
    for (const response of cases) {
      expect(await pollAsset(ID, { fetcher: fetching(response) })).toBeNull();
      expect(await pollScript(ID, { fetcher: fetching(response) })).toBeNull();
    }
  });

  it("a wrong-shaped body is no answer", async () => {
    expect(await pollAsset(ID, { fetcher: fetching(json({ nope: 1 })) })).toBeNull();
    expect(await pollScript(ID, { fetcher: fetching(json([1, 2])) })).toBeNull();
    expect(await refreshBlocks(ID, 50, { fetcher: fetching(json("text")) })).toEqual({
      ok: false,
      error: SERVER_PROBLEM,
    });
  });

  it("result polls answer { ok: false } with the matching message", async () => {
    const fail = (response: Response | Error) =>
      refreshBlocks(ID, 50, { fetcher: fetching(response) });
    expect(await fail(redirect())).toEqual({ ok: false, error: SIGNED_OUT });
    expect(await fail(json({}, { status: 401 }))).toEqual({ ok: false, error: SIGNED_OUT });
    expect(await fail(json({}, { status: 429 }))).toEqual({ ok: false, error: TOO_MANY_REQUESTS });
    expect(await fail(json({}, { status: 500 }))).toEqual({ ok: false, error: SERVER_PROBLEM });
    expect(
      await fail(new Response("<html></html>", { headers: { "Content-Type": "text/html" } })),
    ).toEqual({ ok: false, error: SERVER_PROBLEM });
    expect(await fail(new TypeError("Failed to fetch"))).toEqual({
      ok: false,
      error: SERVER_PROBLEM,
    });
  });

  it("an abort is quiet and the request carries the signal", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        init?.signal?.addEventListener("abort", abort);
        if (init?.signal?.aborted) abort();
      });
    });
    const pending = pollAsset(ID, { fetcher, signal: controller.signal });
    controller.abort();
    expect(await pending).toBeNull();
    const blocks = refreshBlocks(ID, 50, { fetcher, signal: controller.signal });
    expect(await blocks).toEqual({ ok: false, error: SERVER_PROBLEM });
  });
});

describe("pollFinished", () => {
  const event = {
    id: "e1",
    what: "look",
    ready: true,
    projectId: ID,
    projectTitle: "Film",
    assetId: ID,
    assetName: "Ines",
    assetKind: "character",
    fileId: null,
    orientation: "portrait",
    createdAt: "2026-11-13T10:00:00.000Z",
  };

  it("turns createdAt back into a Date", async () => {
    const page = await pollFinished("c0", {
      fetcher: fetching(json({ events: [event], cursor: "c1" })),
    });
    expect(page?.cursor).toBe("c1");
    expect(page?.events[0]?.createdAt).toBeInstanceOf(Date);
    expect(page?.events[0]?.createdAt.toISOString()).toBe("2026-11-13T10:00:00.000Z");
  });

  it("sends the cursor, and none on the first call", async () => {
    const fetcher = fetching(json({ events: [], cursor: "c1" }));
    await pollFinished(null, { fetcher });
    await pollFinished("a_b", { fetcher });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/poll/finished");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/poll/finished?cursor=a_b");
  });

  it("answers null for no answer, a wrong shape or an unreadable date", async () => {
    expect(await pollFinished(null, { fetcher: fetching(json({}, { status: 401 })) })).toBeNull();
    expect(await pollFinished(null, { fetcher: fetching(json({ cursor: 1 })) })).toBeNull();
    expect(
      await pollFinished(null, {
        fetcher: fetching(json({ events: [{ ...event, createdAt: "nope" }], cursor: "c" })),
      }),
    ).toBeNull();
  });
});
