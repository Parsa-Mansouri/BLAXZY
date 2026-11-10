"use client";

import { GroupedList, GroupedListButton } from "@/ui";
import { useSignOut } from "../../_lib/use-sign-out";

export function SignOutButton() {
  const { signOut, pending } = useSignOut();
  return (
    <GroupedList footer="Signing in again needs your password.">
      <GroupedListButton destructive onClick={signOut} disabled={pending}>
        {pending ? "Signing Out…" : "Sign Out"}
      </GroupedListButton>
    </GroupedList>
  );
}
