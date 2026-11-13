/**
 * Development only: grant credits to an account.
 *
 *   pnpm dev:credits <email> <amount> [note]
 *
 * Writes a `grant` entry to the credit ledger. Refuses to run in production or against a
 * non-local database (see assertDevOnly in scripts/_lib.ts).
 */
import "dotenv/config";
import { getBalance, grantCredits } from "../src/server/billing";
import { assertDevOnly, findOwnerId, runScript } from "./_lib";

async function main(): Promise<void> {
  assertDevOnly("dev:credits");
  const [emailArg, amountArg, ...noteParts] = process.argv.slice(2);
  if (!emailArg || !amountArg) throw new Error("Usage: pnpm dev:credits <email> <amount> [note]");
  const amount = Number(amountArg);
  const email = emailArg.trim().toLowerCase();
  const ownerId = await findOwnerId(email);
  const before = await getBalance(ownerId);
  const after = await grantCredits({
    userId: ownerId,
    amount,
    note: noteParts.join(" ") || "dev:credits",
  });
  console.log(`Granted ${amount} credits to ${email}: balance ${before} → ${after}.`);
}

runScript(main);
