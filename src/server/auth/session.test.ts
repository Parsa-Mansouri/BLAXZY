import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  headers: new Headers(),
  raw: null as unknown,
}));

vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("./config", () => ({
  getAuth: () => ({ api: { getSession: async () => state.raw } }),
}));

const { requireAdmin, requireUser, toSessionResult } = await import("./session");
type Raw = Parameters<typeof toSessionResult>[0];

const created = new Date("2026-01-01T00:00:00Z");

function raw(user: Partial<Raw["user"]> = {}): Raw {
  return {
    user: {
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      image: null,
      role: "user",
      disabled: false,
      createdAt: created,
      updatedAt: created,
      ...user,
    },
    session: {
      id: "session-1",
      userId: "user-1",
      token: "secret-token",
      expiresAt: created,
      createdAt: created,
      updatedAt: created,
      ipAddress: undefined,
      userAgent: "agent",
    },
  } as Raw;
}

describe("toSessionResult", () => {
  it("is null for a disabled user", () => {
    expect(toSessionResult(raw({ disabled: true }))).toBeNull();
  });

  it("keeps admin and turns any other role into user", () => {
    expect(toSessionResult(raw({ role: "admin" }))?.user.role).toBe("admin");
    // A value outside the union (an old or hand-edited row) is coerced too.
    const unknownRole = "owner" as string as Raw["user"]["role"];
    expect(toSessionResult(raw({ role: unknownRole }))?.user.role).toBe("user");
    expect(toSessionResult(raw({ role: undefined }))?.user.role).toBe("user");
  });

  it("drops the session token and maps missing values to null", () => {
    const result = toSessionResult(raw({ image: undefined }));
    expect(result?.user.image).toBeNull();
    expect(result?.session.ipAddress).toBeNull();
    expect(result?.session).not.toHaveProperty("token");
    expect(result?.user).not.toHaveProperty("disabled");
  });
});

describe("requireUser and requireAdmin", () => {
  beforeEach(() => {
    state.headers = new Headers({ "x-blaxzy-pathname": "/projects/p1?tab=script" });
    state.raw = null;
  });

  it("sends a signed-out user to login with the current path", async () => {
    await expect(requireUser()).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent("/projects/p1?tab=script")}`,
    );
  });

  it("never puts an unsafe path in next", async () => {
    state.headers = new Headers({ "x-blaxzy-pathname": "//evil.example" });
    await expect(requireUser()).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent("/")}`);
  });

  it("treats a disabled user as signed out", async () => {
    state.raw = raw({ disabled: true });
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login?next=");
  });

  it("sends an unverified user to verify-email", async () => {
    state.raw = raw({ emailVerified: false });
    await expect(requireUser()).rejects.toThrow("REDIRECT:/verify-email");
  });

  it("returns the verified user", async () => {
    state.raw = raw();
    await expect(requireUser()).resolves.toMatchObject({ id: "user-1", role: "user" });
  });

  it("answers 404 to a non-admin and lets an admin through", async () => {
    state.raw = raw();
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    state.raw = raw({ role: "admin" });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
  });
});
