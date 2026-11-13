import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { getSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { account, rateLimit, session, user, USER_ROLES, verification } from "@/server/db/schema";
import { getEmailSender, passwordResetEmail, verificationEmail } from "@/server/email";
import { existingAccountEmail } from "@/server/email/templates";
import { getEnv, type Env } from "@/server/env";
import { logLine } from "@/server/jobs/log";
import { keepAlive, sendInBackground } from "./background";
import {
  AUTH_BASE_PATH,
  AUTH_COOKIE_PREFIX,
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "./constants";

/** Verification and reset links expire after this many seconds (the emails say "1 hour"). */
const TOKEN_TTL_SECONDS = 60 * 60;

/** Endpoints that never act on an existing session, so the disabled-account check skips them. */
function isSessionlessPath(path: string): boolean {
  return (
    path === "/sign-up/email" ||
    path === "/sign-in/email" ||
    path === "/sign-out" ||
    path === "/verify-email" ||
    path === "/send-verification-email" ||
    path === "/request-password-reset" ||
    path.startsWith("/reset-password") ||
    path === "/get-session" || // handled by the after hook below
    path === "/ok" ||
    path === "/error"
  );
}

function isDisabledUser(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "disabled" in value &&
    (value as { disabled: unknown }).disabled === true
  );
}

async function isUserDisabled(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ disabled: user.disabled })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.disabled ?? true;
}

const accountDisabled = () =>
  new APIError("FORBIDDEN", {
    code: "ACCOUNT_DISABLED",
    message: "This account has been disabled.",
  });

/** Endpoints whose body may carry a display name. */
const NAME_PATHS = new Set(["/sign-up/email", "/update-user"]);

const nameTooLong = () =>
  new APIError("BAD_REQUEST", {
    code: "NAME_TOO_LONG",
    message: `Use a name of at most ${MAX_NAME_LENGTH} characters.`,
  });

/**
 * How the auth rate limiter finds the client address. Without a trusted proxy list a forwarded
 * header is believed only when it holds one address, and a header with several is ignored (all
 * such clients then share one bucket), so production behind a proxy must configure one of them.
 */
export function ipAddressOptions(env: Env) {
  if (
    env.NODE_ENV === "production" &&
    !env.AUTH_IP_HEADER &&
    env.AUTH_TRUSTED_PROXIES.length === 0
  ) {
    logLine("warn", "AUTH RATE LIMITING CANNOT IDENTIFY CLIENTS", {
      detail:
        "Neither AUTH_TRUSTED_PROXIES nor AUTH_IP_HEADER is set: a client can rotate " +
        "X-Forwarded-For to escape the sign-in limit, and behind a proxy every user shares one " +
        "bucket. Set AUTH_TRUSTED_PROXIES to your proxies' addresses or AUTH_IP_HEADER to a " +
        "header your proxy overwrites.",
    });
  }
  return {
    ...(env.AUTH_IP_HEADER ? { ipAddressHeaders: [env.AUTH_IP_HEADER] } : {}),
    trustedProxies: env.AUTH_TRUSTED_PROXIES,
  };
}

function createAuth() {
  const env = getEnv();
  const isProduction = env.NODE_ENV === "production";
  const origin = new URL(env.BETTER_AUTH_URL).origin;

  return betterAuth({
    appName: "BLAXZY",
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // In development the dev server may start on another port (3001 when 3000 is taken), so any
    // localhost port is trusted there. Production trusts only the configured origin.
    trustedOrigins: isProduction ? [origin] : [origin, "http://localhost:*", "http://127.0.0.1:*"],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user, session, account, verification, rateLimit },
    }),

    user: {
      additionalFields: {
        // input: false: never accepted from sign-up or update-user payloads.
        role: { type: [...USER_ROLES], required: false, defaultValue: "user", input: false },
        disabled: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // Emails are sent in the background (see `sendInBackground`): the answer must not take
      // longer, or fail, only when the account exists.
      sendResetPassword: async ({ user: recipient, url }) => {
        sendInBackground("password_reset", () =>
          getEmailSender().send(passwordResetEmail(recipient, url)),
        );
      },
      // Signing up again with a registered address answers like a new sign-up; the owner is told
      // by email instead (sign in or reset the password).
      onExistingUserSignUp: async ({ user: recipient }) => {
        sendInBackground("existing_account", () =>
          getEmailSender().send(
            existingAccountEmail(recipient, {
              signInUrl: `${origin}${LOGIN_PATH}`,
              resetPasswordUrl: `${origin}${FORGOT_PASSWORD_PATH}`,
            }),
          ),
        );
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      // An unverified user who tries to sign in gets a fresh link (rate limited).
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: TOKEN_TTL_SECONDS,
      sendVerificationEmail: async ({ user: recipient, url }) => {
        sendInBackground("verification", () =>
          getEmailSender().send(verificationEmail(recipient, url)),
        );
      },
    },

    // Shared across replicas: counters live in the `rate_limit` table. Default rules apply
    // (sign-in / sign-up / change-password: 3 per 10 s; reset and verification emails:
    // 3 per 60 s; everything else: 100 per 10 s), keyed by client IP and path. The client IP
    // comes from `advanced.ipAddress` (AUTH_TRUSTED_PROXIES, AUTH_IP_HEADER).
    rateLimit: {
      enabled: true,
      storage: "database",
    },

    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: isProduction ? true : undefined,
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
      ipAddress: ipAddressOptions(env),
      // Work better-auth defers (rate-limit cleanup, `runInBackgroundOrAwait` callbacks) runs
      // after the response instead of delaying it.
      backgroundTasks: {
        handler: (task) => {
          keepAlive(
            task.catch((error: unknown) => {
              logLine("error", "auth background task failed", {
                error: error instanceof Error ? error.message : String(error),
              });
            }),
          );
        },
      },
    },

    databaseHooks: {
      session: {
        create: {
          // Every way of getting a session (sign-in, auto sign-in after verification) ends here.
          before: async (newSession) => {
            if (await isUserDisabled(newSession.userId)) throw accountDisabled();
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The name is free text stored as given: cap it.
        if (NAME_PATHS.has(ctx.path) && typeof ctx.body === "object" && ctx.body !== null) {
          const name: unknown = (ctx.body as { name?: unknown }).name;
          if (typeof name === "string" && name.length > MAX_NAME_LENGTH) throw nameTooLong();
        }
        // A disabled user with a still-valid cookie: revoke everything and refuse.
        if (!isSessionlessPath(ctx.path) && ctx.headers) {
          if (getSessionCookie(ctx.headers, { cookiePrefix: AUTH_COOKIE_PREFIX })) {
            const current = await getSessionFromCtx(ctx);
            if (current && isDisabledUser(current.user)) {
              await ctx.context.internalAdapter.deleteUserSessions(current.user.id);
              throw accountDisabled();
            }
          }
        }
        // Changing the password always signs out the user's other devices.
        if (ctx.path === "/change-password") {
          const body: Record<string, unknown> =
            typeof ctx.body === "object" && ctx.body !== null ? ctx.body : {};
          return { context: { body: { ...body, revokeOtherSessions: true } } };
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/get-session") return;
        const returned: unknown = ctx.context.returned;
        if (typeof returned !== "object" || returned === null || !("user" in returned)) return;
        const current = returned as { user: { id: string } };
        if (isDisabledUser(current.user)) {
          await ctx.context.internalAdapter.deleteUserSessions(current.user.id);
          return ctx.json(null);
        }
      }),
    },

    // Must stay last: lets server actions that call auth.api.* set cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

/** Lazily created better-auth instance (no env or database access at import time). */
export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
