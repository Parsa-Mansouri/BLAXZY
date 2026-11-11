/**
 * Development only: grant credits to an account.
 *
 *   pnpm dev:credits <email> <amount> [note]
 *
 * Writes a `grant` entry to the credit ledger. Refuses to run when NODE_ENV is "production".
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getBalance, grantCredits } from "../src/server/billing";
import { closeDb, getDb } from "../src/server/db/client";
import { user } from "../src/server/db/schema";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev:credits must never run in production.");
  }
  const [emailArg, amountArg, ...noteParts] = process.argv.slice(2);
  if (!emailArg || !amountArg) throw new Error("Usage: pnpm dev:credits <email> <amount> [note]");
  const amount = Number(amountArg);
  const email = emailArg.trim().toLowerCase();
  const [owner] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!owner)
    throw new Error(`No user ${email}. Create it first: pnpm dev:user ${email} <password>`);
  const before = await getBalance(owner.id);
  const after = await grantCredits({
    userId: owner.id,
    amount,
    note: noteParts.join(" ") || "dev:credits",
  });
  console.log(`Granted ${amount} credits to ${email}: balance ${before} → ${after}.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
