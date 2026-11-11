/**
 * Credits: an append-only ledger (`credit_ledger`) plus a running balance (`credit_balance`).
 * Every entry is written in one transaction with the balance update, holding the user's balance
 * row lock (`FOR UPDATE`), so concurrent operations serialise per user and the balance can never
 * go negative. The balance always equals the sum of the user's ledger amounts.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbTx } from "@/server/db/client";
import { creditBalance, creditLedger, type CreditEntryType } from "@/server/db/schema";
import { BillingInputError, InsufficientCreditsError } from "./errors";

/** A transaction handle; pass one to run inside the caller's transaction. */
export type DbTransaction = DbTx;

/** Largest single grant. */
export const MAX_GRANT = 1_000_000;
/** Largest single reservation (one generation's price). */
export const MAX_RESERVE = 1_000_000;
/** Largest balance a user may hold (well inside a Postgres integer). */
export const MAX_BALANCE = 1_000_000_000;
export const MAX_NOTE_LENGTH = 500;
export const DEFAULT_LEDGER_PAGE = 20;
export const MAX_LEDGER_PAGE = 100;

export type LedgerEntry = {
  id: string;
  type: CreditEntryType;
  /** Signed: grants and refunds are positive, reserves negative, settles zero. */
  amount: number;
  generationId: string | null;
  note: string | null;
  createdAt: Date;
};

export type LedgerPage = { items: LedgerEntry[]; nextCursor: string | null };

const userIdSchema = z.string().trim().min(1).max(128);
const uuidSchema = z.uuid();

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BillingInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}

const grantSchema = z.object({
  userId: userIdSchema,
  amount: z
    .number({ error: "The amount must be a whole number." })
    .int("The amount must be a whole number.")
    .min(1, "The amount must be at least 1 credit.")
    .max(MAX_GRANT, `A single grant is at most ${MAX_GRANT} credits.`),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
  createdBy: userIdSchema.optional(),
});

const reserveSchema = z.object({
  userId: userIdSchema,
  generationId: uuidSchema,
  amount: z
    .number({ error: "The price must be a whole number." })
    .int("The price must be a whole number.")
    .min(0, "The price cannot be negative.")
    .max(MAX_RESERVE, `A single price is at most ${MAX_RESERVE} credits.`),
});

const generationSchema = z.object({ generationId: uuidSchema });

const listSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LEDGER_PAGE).default(DEFAULT_LEDGER_PAGE),
  cursor: z.string().max(200).nullish(),
});

function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function inTransaction<T>(tx: DbTx | undefined, run: (tx: DbTx) => Promise<T>): Promise<T> {
  return tx ? run(tx) : getDb().transaction(run);
}

/** Locks (creating it if needed) the user's balance row and returns the balance. */
async function lockBalance(tx: DbTx, userId: string): Promise<number> {
  const select = () =>
    tx
      .select({ balance: creditBalance.balance })
      .from(creditBalance)
      .where(eq(creditBalance.userId, userId))
      .for("update");
  const [existing] = await select();
  if (existing) return existing.balance;
  try {
    await tx.insert(creditBalance).values({ userId, balance: 0 }).onConflictDoNothing();
  } catch (err) {
    if (pgErrorCode(err) === "23503") throw new BillingInputError("That account does not exist.");
    throw err;
  }
  const [created] = await select();
  if (!created) throw new Error(`credit_balance row for ${userId} is missing after insert`);
  return created.balance;
}

async function setBalance(tx: DbTx, userId: string, balance: number): Promise<void> {
  await tx.update(creditBalance).set({ balance }).where(eq(creditBalance.userId, userId));
}

/** The user's balance in credits (0 when they never had any). */
export async function getBalance(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ balance: creditBalance.balance })
    .from(creditBalance)
    .where(eq(creditBalance.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/** Adds credits (admin or development use). Returns the new balance. */
export async function grantCredits(input: {
  userId: string;
  amount: number;
  note?: string;
  createdBy?: string;
}): Promise<number> {
  const { userId, amount, note, createdBy } = parse(grantSchema, input);
  return getDb().transaction(async (tx) => {
    const balance = await lockBalance(tx, userId);
    const next = balance + amount;
    if (next > MAX_BALANCE) {
      throw new BillingInputError(`A balance cannot exceed ${MAX_BALANCE} credits.`);
    }
    await tx.insert(creditLedger).values({
      userId,
      type: "grant",
      amount,
      note: note || null,
      createdBy: createdBy ?? null,
    });
    await setBalance(tx, userId, next);
    return next;
  });
}

/**
 * Reserves a generation's price: the credits leave the balance now and are settled (spent) or
 * refunded when the generation finishes. Throws `InsufficientCreditsError` when the balance does
 * not cover it. Calling it again for the same generation and amount does nothing.
 */
export async function reserve(
  input: { userId: string; generationId: string; amount: number },
  tx?: DbTransaction,
): Promise<void> {
  const { userId, generationId, amount } = parse(reserveSchema, input);
  await inTransaction(tx, async (db) => {
    const balance = await lockBalance(db, userId);
    const [existing] = await db
      .select({ userId: creditLedger.userId, amount: creditLedger.amount })
      .from(creditLedger)
      .where(and(eq(creditLedger.generationId, generationId), eq(creditLedger.type, "reserve")))
      .limit(1);
    if (existing) {
      if (existing.userId === userId && existing.amount === -amount) return;
      throw new BillingInputError("Credits for this generation were already reserved.");
    }
    if (balance < amount) throw new InsufficientCreditsError(balance, amount);
    await db
      .insert(creditLedger)
      .values({ userId, type: "reserve", amount: -amount, generationId });
    await setBalance(db, userId, balance - amount);
  });
}

/** Settle or refund a generation's reservation, once; the two exclude each other. */
async function closeReservation(
  type: "settle" | "refund",
  input: { generationId: string },
  tx: DbTransaction | undefined,
): Promise<void> {
  const { generationId } = parse(generationSchema, input);
  await inTransaction(tx, async (db) => {
    const [reserved] = await db
      .select({ userId: creditLedger.userId, amount: creditLedger.amount })
      .from(creditLedger)
      .where(and(eq(creditLedger.generationId, generationId), eq(creditLedger.type, "reserve")))
      .limit(1);
    if (!reserved) throw new BillingInputError("No credits were reserved for this generation.");
    // The balance lock serialises this against a concurrent settle/refund of the same generation.
    const balance = await lockBalance(db, reserved.userId);
    const closed = await db
      .select({ type: creditLedger.type })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.generationId, generationId),
          inArray(creditLedger.type, ["settle", "refund"]),
        ),
      );
    if (closed.some((e) => e.type === type)) return;
    if (closed.length > 0) {
      throw new BillingInputError(
        type === "settle"
          ? "This generation's credits were already refunded."
          : "This generation's credits were already spent.",
      );
    }
    const reservedAmount = -reserved.amount;
    await db.insert(creditLedger).values({
      userId: reserved.userId,
      type,
      amount: type === "refund" ? reservedAmount : 0,
      generationId,
    });
    await setBalance(db, reserved.userId, type === "refund" ? balance + reservedAmount : balance);
  });
}

/** Marks the generation's reservation as spent. Idempotent; refuses a refunded generation. */
export function settle(input: { generationId: string }, tx?: DbTransaction): Promise<void> {
  return closeReservation("settle", input, tx);
}

/** Returns the generation's reserved credits. Idempotent; refuses a settled generation. */
export function refund(input: { generationId: string }, tx?: DbTransaction): Promise<void> {
  return closeReservation("refund", input, tx);
}

/** Microsecond-precise ISO text of `created_at`, for exact keyset cursors. */
const createdAtText = sql<string>`to_char(${creditLedger.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const bad = new BillingInputError("That page link is no longer valid. Reload the list.");
  const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (rest.length > 0 || !createdAt || !id) throw bad;
  if (!CURSOR_PATTERN.test(createdAt) || !uuidSchema.safeParse(id).success) throw bad;
  return { createdAt, id };
}

/** The user's ledger, newest first, with keyset pagination. */
export async function listLedger(
  userId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<LedgerPage> {
  const { limit, cursor } = parse(listSchema, opts);
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await getDb()
    .select({ row: creditLedger, cursorTs: createdAtText })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        after
          ? sql`(${creditLedger.createdAt}, ${creditLedger.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ row }) => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      generationId: row.generationId,
      note: row.note,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.cursorTs, last.row.id) : null,
  };
}
