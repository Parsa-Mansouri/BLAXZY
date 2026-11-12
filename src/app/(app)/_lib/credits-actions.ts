"use server";

import { requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";

/** The signed-in user's credit balance (one indexed read), for the sidebar to stay current. */
export async function creditBalanceAction(): Promise<number> {
  const user = await requireUser();
  return getBalance(user.id);
}
