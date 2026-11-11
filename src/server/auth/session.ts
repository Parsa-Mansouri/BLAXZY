import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { UserRole } from "@/server/db/schema";
import { getAuth } from "./config";
import { LOGIN_PATH, PATHNAME_HEADER, VERIFY_EMAIL_PATH } from "./constants";
import { safeNextPath } from "./safe-next-path";

/** The signed-in user as the app sees it. No password hashes, tokens or internal flags. */
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

/** The current session without its token (the token is the cookie secret). */
export type AuthSession = {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export type SessionResult = { user: AuthUser; session: AuthSession };

type RawSession = NonNullable<Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>>;

export function toSessionResult(raw: RawSession): SessionResult | null {
  if (raw.user.disabled) return null;
  return {
    user: {
      id: raw.user.id,
      name: raw.user.name,
      email: raw.user.email,
      emailVerified: raw.user.emailVerified,
      image: raw.user.image ?? null,
      role: raw.user.role === "admin" ? "admin" : "user",
      createdAt: raw.user.createdAt,
      updatedAt: raw.user.updatedAt,
    },
    session: {
      id: raw.session.id,
      userId: raw.session.userId,
      expiresAt: raw.session.expiresAt,
      createdAt: raw.session.createdAt,
      ipAddress: raw.session.ipAddress ?? null,
      userAgent: raw.session.userAgent ?? null,
    },
  };
}

/**
 * The current session, or null when signed out (or the account is disabled). Cached per
 * request, so layouts and pages can all call it. Works in server components, server actions
 * and route handlers.
 */
export const getSession = cache(async (): Promise<SessionResult | null> => {
  // Read the headers first: that marks the route dynamic before anything needs the runtime env
  // (otherwise `next build` without env fails while trying to prerender signed-in pages).
  const requestHeaders = await headers();
  const raw = await getAuth().api.getSession({ headers: requestHeaders });
  return raw ? toSessionResult(raw) : null;
});

async function currentPath(): Promise<string> {
  return safeNextPath((await headers()).get(PATHNAME_HEADER));
}

/**
 * The signed-in, verified user. Redirects to `/login?next=<current path>` when signed out and
 * to `/verify-email` when the email is not verified yet.
 */
export async function requireUser(): Promise<AuthUser> {
  const result = await getSession();
  if (!result) {
    const next = await currentPath();
    redirect(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
  }
  if (!result.user.emailVerified) redirect(VERIFY_EMAIL_PATH);
  return result.user;
}

/** Like `requireUser`, and responds 404 to anyone who is not an admin. */
export async function requireAdmin(): Promise<AuthUser> {
  const authUser = await requireUser();
  if (authUser.role !== "admin") notFound();
  return authUser;
}
