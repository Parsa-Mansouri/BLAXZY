/**
 * The ledger's integrity is enforced by the database too (migration 0009), not only by the
 * service: a negative balance, a negative price, and a reservation both settled and refunded are
 * rejected even when written directly. Skipped when the database is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { databaseReachable } from "../test-support/script-fixtures";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("ledger constraints (integration)", async () => {
  const billing = await import("@/server/billing");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { creditBalance, creditLedger, generation } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const { createGenerationFixtures } = await import("../test-support/generation-fixtures");
  const fixtures = createGenerationFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeDb();
  });

  /** The Postgres error code of a rejected statement (drizzle wraps the driver's error). */
  async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
      return undefined;
    } catch (err) {
      for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
        const code = (e as { code?: unknown }).code;
        if (typeof code === "string") return code;
      }
      return "unknown";
    }
  }

  it("rejects a negative balance", async () => {
    const userId = await fixtures.newUser();
    await billing.grantCredits({ userId, amount: 5 });
    expect(
      await pgCode(
        getDb().update(creditBalance).set({ balance: -1 }).where(eq(creditBalance.userId, userId)),
      ),
    ).toBe("23514");
    expect(await billing.getBalance(userId)).toBe(5);
  });

  it("rejects a negative price", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const id = await fixtures.insertGeneration({ userId, projectId });
    expect(
      await pgCode(
        getDb().update(generation).set({ priceCredits: -3 }).where(eq(generation.id, id)),
      ),
    ).toBe("23514");
  });

  it("never lets one reservation be both settled and refunded", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    await billing.grantCredits({ userId, amount: 10 });
    const id = await fixtures.insertGeneration({ userId, projectId, priceCredits: 4 });
    await billing.reserve({ userId, generationId: id, amount: 4 });
    await billing.settle({ generationId: id });
    expect(
      await pgCode(
        getDb()
          .insert(creditLedger)
          .values({ userId, type: "refund", amount: 4, generationId: id }),
      ),
    ).toBe("23505");
  });
});
