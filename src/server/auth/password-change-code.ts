import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { verification } from "@/server/db/schema";
import { getEmailSender } from "@/server/email";
import { passwordChangeCodeEmail } from "@/server/email/templates";
import { sendInBackground } from "./background";

/**
 * The six-digit code a signed-in user must enter to change their password. It is kept in
 * better-auth's `verification` table (short-lived auth secrets, not domain records): one row per
 * user, holding only a SHA-256 of the code and the number of wrong tries.
 */

/** Codes expire after this many seconds (the email says "10 minutes"). */
export const PASSWORD_CHANGE_CODE_TTL_SECONDS = 10 * 60;
/** Wrong tries one code allows; after that a new code must be requested. */
export const PASSWORD_CHANGE_CODE_ATTEMPTS = 5;
export { PASSWORD_CHANGE_CODE_HEADER } from "./constants";

export type PasswordChangeCodeCheck = "ok" | "missing" | "invalid" | "expired" | "too_many";

const identifierFor = (userId: string) => `password-change:${userId}`;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Issues a fresh code (any earlier one stops working) and emails it in the background. */
export async function issuePasswordChangeCode(user: { id: string; email: string }): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const identifier = identifierFor(user.id);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier,
      value: `${hashCode(code)}:0`,
      expiresAt: new Date(Date.now() + PASSWORD_CHANGE_CODE_TTL_SECONDS * 1000),
    });
  });
  sendInBackground("password_change_code", () =>
    getEmailSender().send(passwordChangeCodeEmail({ email: user.email }, code)),
  );
}

/** Checks `code` against the user's current code; a wrong one counts as a try. */
export async function checkPasswordChangeCode(
  userId: string,
  code: string | null | undefined,
): Promise<PasswordChangeCodeCheck> {
  if (!code || !/^\d{6}$/.test(code)) return code ? "invalid" : "missing";
  const identifier = identifierFor(userId);
  const db = getDb();
  const [row] = await db
    .select({ id: verification.id, value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return "expired";

  const split = row.value.lastIndexOf(":");
  const stored = row.value.slice(0, split);
  const attempts = Number(row.value.slice(split + 1)) || 0;
  if (attempts >= PASSWORD_CHANGE_CODE_ATTEMPTS) return "too_many";
  if (sameHash(stored, hashCode(code))) return "ok";

  await db
    .update(verification)
    .set({ value: `${stored}:${attempts + 1}`, updatedAt: new Date() })
    .where(and(eq(verification.id, row.id), eq(verification.value, row.value)));
  return attempts + 1 >= PASSWORD_CHANGE_CODE_ATTEMPTS ? "too_many" : "invalid";
}

/** Retires the user's code once the password has been changed with it. */
export async function consumePasswordChangeCode(userId: string): Promise<void> {
  await getDb()
    .delete(verification)
    .where(eq(verification.identifier, identifierFor(userId)));
}
