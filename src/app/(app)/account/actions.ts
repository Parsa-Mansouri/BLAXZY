"use server";

import { issuePasswordChangeCode } from "@/server/auth";
import { userAction, type ActionFailure } from "../_lib/action";

/** Emails the signed-in user a six-digit code; the password change needs it. */
export async function sendPasswordChangeCodeAction(): Promise<
  { ok: true; email: string } | ActionFailure
> {
  return userAction("codeSend", "account.sendPasswordChangeCode", async (user) => {
    await issuePasswordChangeCode({ id: user.id, email: user.email });
    return { ok: true, email: user.email };
  });
}
