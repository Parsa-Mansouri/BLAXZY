"use client";

import { Button, stagger } from "@/ui";
import { useSignOut } from "../../_lib/use-sign-out";

export function SignOutButton() {
  const { signOut, pending } = useSignOut();
  return (
    <div className="enter" style={stagger(0, 460)}>
      <Button variant="outlined" onClick={signOut} loading={pending}>
        Sign Out
      </Button>
    </div>
  );
}
