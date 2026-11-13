/**
 * Runs better-auth against the real local Postgres (`docker compose up -d`, `pnpm db:migrate`).
 * Skipped automatically when DATABASE_URL is missing or unreachable.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { databaseReachable } from "@/server/test-support/integration";
import { ConsoleEmailSender, type EmailMessage } from "@/server/email";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("auth (integration)", async () => {
  const { getAuth } = await import("@/server/auth/config");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { user, session } = await import("@/server/db/schema");

  const auth = getAuth();
  const createdUserIds: string[] = [];
  const sent: EmailMessage[] = [];
  vi.spyOn(ConsoleEmailSender.prototype, "send").mockImplementation(async (message) => {
    sent.push(message);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await getDb().delete(user).where(inArray(user.id, createdUserIds));
    }
    await closeDb();
    vi.restoreAllMocks();
  });

  const newEmail = () => `it-${randomUUID()}@example.test`;

  async function signUp(email: string, password: string, extra: Record<string, unknown> = {}) {
    // A non-literal body: the signup payload is untyped input from the client.
    const body = { name: "Integration Test", email, password, ...extra };
    const result = await auth.api.signUpEmail({ body });
    createdUserIds.push(result.user.id);
    return result;
  }

  function lastLinkFor(email: string): string {
    const message = sent.filter((m) => m.to === email).at(-1);
    if (!message?.actionUrl) throw new Error(`no email with a link was sent to ${email}`);
    return message.actionUrl;
  }

  async function verify(email: string) {
    const token = new URL(lastLinkFor(email)).searchParams.get("token");
    if (!token) throw new Error("verification link has no token");
    await auth.api.verifyEmail({ query: { token } });
  }

  async function signIn(email: string, password: string): Promise<Headers> {
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    const cookie = (headers.get("set-cookie") ?? "")
      .split(/,(?=\s*[\w.-]+=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
    return new Headers({ cookie });
  }

  async function expectStatus(promise: Promise<unknown>, status: number) {
    await expect(promise).rejects.toMatchObject({ statusCode: status });
  }

  it("requires verification, then allows sign-in and password change", async () => {
    const email = newEmail();
    const first = "first-password-123";
    const second = "second-password-456";

    const signedUp = await signUp(email, first);
    expect(signedUp.token).toBeNull();
    expect(lastLinkFor(email)).toContain("/api/auth/verify-email?token=");

    await expectStatus(auth.api.signInEmail({ body: { email, password: first } }), 403);

    await verify(email);
    const cookies = await signIn(email, first);
    const current = await auth.api.getSession({ headers: cookies });
    expect(current?.user.email).toBe(email);
    const otherDevice = await signIn(email, first);

    // The client does not ask for it; the server forces revokeOtherSessions.
    await auth.api.changePassword({
      body: { currentPassword: first, newPassword: second },
      headers: cookies,
    });
    expect(await auth.api.getSession({ headers: otherDevice })).toBeNull();

    await expectStatus(auth.api.signInEmail({ body: { email, password: first } }), 401);
    await expect(signIn(email, second)).resolves.toBeInstanceOf(Headers);
  });

  it("rejects passwords outside the length limits", async () => {
    await expectStatus(
      auth.api.signUpEmail({ body: { name: "x", email: newEmail(), password: "short" } }),
      400,
    );
    await expectStatus(
      auth.api.signUpEmail({ body: { name: "x", email: newEmail(), password: "a".repeat(129) } }),
      400,
    );
  });

  it("blocks a disabled user from signing in and from using an existing session", async () => {
    const email = newEmail();
    const password = "disabled-password-123";
    const { user: created } = await signUp(email, password);
    await verify(email);
    const cookies = await signIn(email, password);

    await getDb().update(user).set({ disabled: true }).where(eq(user.id, created.id));

    expect(await auth.api.getSession({ headers: cookies })).toBeNull();
    const remaining = await getDb().select().from(session).where(eq(session.userId, created.id));
    expect(remaining).toHaveLength(0);

    await expectStatus(auth.api.signInEmail({ body: { email, password } }), 403);
  });

  it("revokes a disabled user's session on session-protected endpoints", async () => {
    const email = newEmail();
    const password = "disabled-password-456";
    const { user: created } = await signUp(email, password);
    await verify(email);
    const cookies = await signIn(email, password);

    await getDb().update(user).set({ disabled: true }).where(eq(user.id, created.id));

    await expectStatus(auth.api.listSessions({ headers: cookies }), 403);
    const remaining = await getDb().select().from(session).where(eq(session.userId, created.id));
    expect(remaining).toHaveLength(0);
  });

  it("ignores role and disabled in the signup payload", async () => {
    const email = newEmail();
    const { user: created } = await signUp(email, "role-password-123", {
      role: "admin",
      disabled: true,
    });
    const [row] = await getDb().select().from(user).where(eq(user.id, created.id));
    expect(row?.role).toBe("user");
    expect(row?.disabled).toBe(false);
  });

  it("refuses role changes through update-user", async () => {
    const email = newEmail();
    const password = "update-password-123";
    const { user: created } = await signUp(email, password);
    await verify(email);
    const cookies = await signIn(email, password);

    const body = { role: "admin" };
    await expectStatus(auth.api.updateUser({ body, headers: cookies }), 400);
    const [row] = await getDb().select().from(user).where(eq(user.id, created.id));
    expect(row?.role).toBe("user");
  });
});
