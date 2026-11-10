"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/** Signs out, then goes to the sign-in page whatever the outcome. */
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return { signOut, pending };
}
