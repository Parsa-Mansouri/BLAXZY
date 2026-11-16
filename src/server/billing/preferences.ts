/** The user's billing preferences. Only the owner reads or changes them (by their own id). */
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

/**
 * Whether the user chose to skip the "this will cost N credits" dialog. A screen preference only:
 * the services check the confirmed price on every paid action whatever this says.
 */
export async function getSkipCreditConfirm(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ skip: user.skipCreditConfirm })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.skip ?? false;
}

/** Turns the dialog off (true) or back on (false) for the user. Returns the stored value. */
export async function setSkipCreditConfirm(userId: string, skip: boolean): Promise<boolean> {
  const [row] = await getDb()
    .update(user)
    .set({ skipCreditConfirm: skip })
    .where(eq(user.id, userId))
    .returning({ skip: user.skipCreditConfirm });
  return row?.skip ?? false;
}
