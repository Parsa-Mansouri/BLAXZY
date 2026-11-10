/**
 * Development only: create (or reset) a verified admin account for local testing.
 *
 *   pnpm dev:user <email> <password> [name]
 *
 * It writes the user directly, so it skips email verification and the password length rule.
 * It refuses to run when NODE_ENV is "production". Credentials are never stored in the repo.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { getAuth } from "../src/server/auth";
import { closeDb, getDb } from "../src/server/db/client";
import { account, session, user } from "../src/server/db/schema";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev:user must never run in production.");
  }
  const [emailArg, password, name = "Test User"] = process.argv.slice(2);
  if (!emailArg || !password) {
    throw new Error("Usage: pnpm dev:user <email> <password> [name]");
  }
  const email = emailArg.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const db = getDb();

  const userId = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    const id = existing?.id ?? randomUUID();
    if (existing) {
      await tx
        .update(user)
        .set({ name, role: "admin", emailVerified: true, disabled: false })
        .where(eq(user.id, id));
    } else {
      await tx.insert(user).values({ id, name, email, role: "admin", emailVerified: true });
    }

    const [credential] = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, id), eq(account.providerId, "credential")));
    if (credential) {
      await tx.update(account).set({ password: passwordHash }).where(eq(account.id, credential.id));
    } else {
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: passwordHash,
      });
    }
    return id;
  });

  // Prove the account works through the real sign-in path, then drop the session it created.
  await getAuth().api.signInEmail({ body: { email, password } });
  await db.delete(session).where(eq(session.userId, userId));

  console.log(`Dev admin ready: ${email} (id ${userId}), sign-in verified.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
