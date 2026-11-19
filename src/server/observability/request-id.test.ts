import { describe, expect, it, vi } from "vitest";
import { inRequestScope } from "./request";
import { isWellFormedRequestId, requestIdFrom, shortReference } from "./request-id";
import { currentRequestId, withRequestScope } from "./scope";

vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("outside a request");
  },
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request ids", () => {
  it("keeps a well-formed incoming id", () => {
    expect(requestIdFrom("abc12345-proxy.id:7")).toBe("abc12345-proxy.id:7");
  });

  it.each([
    null,
    undefined,
    "",
    "short",
    "has space here",
    "x".repeat(129),
    "<script>alert</script>",
  ])("replaces %j with a new UUID", (incoming) => {
    expect(isWellFormedRequestId(incoming)).toBe(false);
    expect(requestIdFrom(incoming)).toMatch(UUID);
  });

  it("generates a different id each time", () => {
    expect(requestIdFrom(null)).not.toBe(requestIdFrom(null));
  });

  it("shortens an id to its first 8 characters", () => {
    expect(shortReference("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe("1a2b3c4d");
  });
});

describe("request scope", () => {
  it("is visible across awaits inside the scope and gone outside it", async () => {
    expect(currentRequestId()).toBeUndefined();
    await withRequestScope("req-aaaaaaaa", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentRequestId()).toBe("req-aaaaaaaa");
    });
    expect(currentRequestId()).toBeUndefined();
  });

  it("keeps concurrent requests apart", async () => {
    const seen = await Promise.all(
      ["req-11111111", "req-22222222"].map((id) =>
        withRequestScope(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return currentRequestId();
        }),
      ),
    );
    expect(seen).toEqual(["req-11111111", "req-22222222"]);
  });

  it("enters with the id from the given headers, or a new one", async () => {
    const fromHeader = await inRequestScope(
      async () => currentRequestId(),
      new Headers({ "x-request-id": "from-proxy-123" }),
    );
    expect(fromHeader).toBe("from-proxy-123");
    // Outside a request (next/headers throws): a new id.
    expect(await inRequestScope(async () => currentRequestId())).toMatch(UUID);
  });

  it("keeps the scope it is already in", async () => {
    const inner = await withRequestScope("outer-request", () =>
      inRequestScope(async () => currentRequestId(), new Headers({ "x-request-id": "inner-1234" })),
    );
    expect(inner).toBe("outer-request");
  });
});
