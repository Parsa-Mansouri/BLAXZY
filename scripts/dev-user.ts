/**
 * Development only: create a verified admin account for local testing.
 *
 *   pnpm dev:user <email> [name] [--update-existing]
 *
 * The password is read from the DEV_USER_PASSWORD environment variable, else prompted for (hidden
 * on a terminal, first line of stdin when piped). It is never taken from the command line, where
 * it would end up in the shell history. It writes the user directly, so it skips email
 * verification and the password length rule. An existing user with that email is left alone
 * unless --update-existing is passed (then it becomes a verified admin with the new password).
 * Refuses to run in production or against a non-local database (see assertDevOnly in
 * scripts/_lib.ts). Credentials are never stored in the repo.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { getAuth } from "../src/server/auth";
import { getDb } from "../src/server/db/client";
import { account, session, user } from "../src/server/db/schema";
import { assertDevOnly, runScript } from "./_lib";

async function readPassword(): Promise<string> {
  const fromEnv = process.env.DEV_USER_PASSWORD;
  if (fromEnv) return fromEnv;
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stderr.write(chunk);
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: Boolean(process.stdin.isTTY),
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.once("close", () => reject(new Error("No password given (set DEV_USER_PASSWORD).")));
      rl.question("Password: ", (answer) => {
        resolve(answer);
      });
      muted = true;
    });
  } finally {
    rl.close();
    if (process.stdin.isTTY) process.stderr.write("\n");
  }
}

async function main(): Promise<void> {
  assertDevOnly("dev:user");
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const updateExisting = args.includes("--update-existing");
  const [emailArg, name = "Test User", ...extra] = args.filter((arg) => !arg.startsWith("--"));
  if (!emailArg || extra.length > 0) {
    throw new Error("Usage: pnpm dev:user <email> [name] [--update-existing]");
  }
  const email = emailArg.trim().toLowerCase();
  const db = getDb();
  const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existingUser && !updateExisting) {
    throw new Error(
      `User ${email} already exists. Pass --update-existing to make it a verified admin with a new password.`,
    );
  }
  const password = await readPassword();
  if (!password) throw new Error("The password is empty.");
  const passwordHash = await hashPassword(password);

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

runScript(main);
