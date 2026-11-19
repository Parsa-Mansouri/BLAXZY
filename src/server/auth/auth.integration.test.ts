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
  const { actionRateLimit, user, session, verification } = await import("@/server/db/schema");
  const { getEnv } = await import("@/server/env");
  const { MAX_NAME_LENGTH } = await import("@/server/auth/constants");

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
    const message = sent.filter((m) => m.to === email && m.actionUrl).at(-1);
    if (!message?.actionUrl) throw new Error(`no email with a link was sent to ${email}`);
    return message.actionUrl;
  }

  function codeMailsFor(email: string): EmailMessage[] {
    return sent.filter((m) => m.to === email && m.subject === "Your BLAXZY verification code");
  }

  /**
   * Waits for verification code mail number `count` to `email` (codes are stored and sent in the
   * background) and returns its code.
   */
  async function codeFor(email: string, count = 1): Promise<string> {
    return vi.waitFor(() => {
      const mails = codeMailsFor(email);
      if (mails.length < count) throw new Error(`no code mail ${count} for ${email} yet`);
      const code = /^(\d{6})$/m.exec(mails.at(-1)?.text ?? "")?.[1];
      if (!code) throw new Error("code mail has no code");
      return code;
    });
  }

  async function verify(email: string) {
    await auth.api.verifyEmailOTP({ body: { email, otp: await codeFor(email) } });
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
    const code = await codeFor(email);
    expect(codeMailsFor(email)[0]?.actionUrl).toBeUndefined();

    // Signing in while unverified is refused and sends a fresh code (the first one stops working).
    await expectStatus(auth.api.signInEmail({ body: { email, password: first } }), 403);
    const fresh = await codeFor(email, 2);
    if (fresh !== code) {
      await expectStatus(auth.api.verifyEmailOTP({ body: { email, otp: code } }), 400);
    }

    // A right code verifies the address and signs the user in.
    const verified = await auth.api.verifyEmailOTP({
      body: { email, otp: fresh },
      returnHeaders: true,
    });
    expect(verified.response.status).toBe(true);
    expect(verified.response.token).toEqual(expect.any(String));
    expect(verified.headers.get("set-cookie") ?? "").toContain("session_token");

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

  /** Requests a reset link for `email` and returns its token (the last path segment). */
  async function requestReset(email: string): Promise<string> {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    const token = new URL(lastLinkFor(email)).pathname.split("/").at(-1);
    if (!token) throw new Error("reset link has no token");
    return token;
  }

  it("resets a password once, revokes every session and refuses the used token", async () => {
    const email = newEmail();
    const first = "reset-first-123";
    const second = "reset-second-456";
    await signUp(email, first);
    await verify(email);
    const cookies = await signIn(email, first);

    const token = await requestReset(email);
    expect(lastLinkFor(email)).toContain(`/api/auth/reset-password/${token}`);
    await auth.api.resetPassword({ body: { newPassword: second, token } });

    expect(await auth.api.getSession({ headers: cookies })).toBeNull();
    await expectStatus(auth.api.signInEmail({ body: { email, password: first } }), 401);
    await expect(signIn(email, second)).resolves.toBeInstanceOf(Headers);
    // Single use: the same token cannot set a password again.
    await expectStatus(
      auth.api.resetPassword({ body: { newPassword: "reset-third-789", token } }),
      400,
    );
  });

  it("refuses an expired reset token", async () => {
    const email = newEmail();
    await signUp(email, "expired-first-123");
    await verify(email);
    const token = await requestReset(email);
    await getDb()
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`));

    await expectStatus(
      auth.api.resetPassword({ body: { newPassword: "expired-second-456", token } }),
      400,
    );
    await expect(signIn(email, "expired-first-123")).resolves.toBeInstanceOf(Headers);
  });

  it("keeps a disabled user out after a password reset", async () => {
    const email = newEmail();
    const { user: created } = await signUp(email, "disabled-reset-123");
    await verify(email);
    await getDb().update(user).set({ disabled: true }).where(eq(user.id, created.id));

    const token = await requestReset(email);
    await auth.api.resetPassword({ body: { newPassword: "disabled-reset-456", token } });
    await expectStatus(
      auth.api.signInEmail({ body: { email, password: "disabled-reset-456" } }),
      403,
    );
  });

  it("answers a repeated sign-up like a new one and tells the owner by email", async () => {
    const email = newEmail();
    await signUp(email, "existing-first-123");
    await verify(email);
    const before = sent.length;

    const again = await auth.api.signUpEmail({
      body: { name: "Someone Else", email, password: "existing-other-456" },
    });
    expect(again.token).toBeNull();
    const notice = sent.slice(before).find((m) => m.to === email);
    expect(notice?.subject).toBe("You already have a BLAXZY account");
    expect(notice?.text).toContain("/login");
    expect(notice?.text).toContain("/forgot-password");
    expect(notice?.text).not.toContain("Someone Else");
    expect(notice?.actionUrl).toBeUndefined();
  });

  it("refuses a name longer than the limit", async () => {
    await expectStatus(
      auth.api.signUpEmail({
        body: {
          name: "n".repeat(MAX_NAME_LENGTH + 1),
          email: newEmail(),
          password: "long-name-123",
        },
      }),
      400,
    );
    const { user: created } = await signUp(newEmail(), "ok-name-123456", {
      name: "n".repeat(MAX_NAME_LENGTH),
    });
    expect(created.name).toHaveLength(MAX_NAME_LENGTH);
  });

  it("does not wait for, or fail on, the email sender", async () => {
    const email = newEmail();
    await signUp(email, "slow-mail-123");
    await verify(email);

    // A sender that never answers: the endpoint still returns.
    const send = vi.mocked(ConsoleEmailSender.prototype.send);
    send.mockImplementationOnce(() => new Promise<void>(() => {}));
    await expect(
      auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } }),
    ).resolves.toMatchObject({ status: true });

    // A sender that fails: the endpoint answers the same and the failure is logged.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockImplementationOnce(() => Promise.reject(new Error("smtp down")));
    await expect(
      auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } }),
    ).resolves.toMatchObject({ status: true });
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    const line = String(logged.mock.calls.at(-1)?.[0]);
    expect(line).toContain("auth email failed");
    expect(line).toContain("password_reset");
    expect(line).not.toContain("token");
    logged.mockRestore();
  });

  it("locks a code after five wrong guesses", async () => {
    const email = newEmail();
    await signUp(email, "wrong-code-123");
    const code = await codeFor(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await expectStatus(auth.api.verifyEmailOTP({ body: { email, otp: wrong } }), 400);
    }
    // The sixth try, even with the right code, is refused: per-address cap (5 a minute) first.
    await expectStatus(auth.api.verifyEmailOTP({ body: { email, otp: code } }), 429);
    await getDb()
      .delete(actionRateLimit)
      .where(eq(actionRateLimit.key, `otp:${email}`));
    // With the cap cleared the code itself is used up: a new one must be requested.
    await expectStatus(auth.api.verifyEmailOTP({ body: { email, otp: code } }), 403);
    await expectStatus(auth.api.verifyEmailOTP({ body: { email, otp: code } }), 400);
  });

  it("never sends a code to, or accepts one for, a verified account", async () => {
    const email = newEmail();
    await signUp(email, "verified-code-123");
    await verify(email);
    const before = codeMailsFor(email).length;

    await auth.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
    await auth.api.sendVerificationEmail({ body: { email } });
    // Give the background sends a moment: nothing may arrive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(codeMailsFor(email)).toHaveLength(before);
    await expectStatus(auth.api.verifyEmailOTP({ body: { email, otp: "123456" } }), 400);
  });

  it("sends only verification codes and serves no other OTP route", async () => {
    await expectStatus(
      auth.api.sendVerificationOTP({ body: { email: newEmail(), type: "sign-in" } }),
      400,
    );
    const base = getEnv().BETTER_AUTH_URL;
    for (const path of ["/sign-in/email-otp", "/email-otp/reset-password"]) {
      const response = await auth.handler(
        new Request(`${base}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: newEmail(), otp: "123456", password: "x-123456789" }),
        }),
      );
      expect(response.status).toBe(404);
    }
  });
});
