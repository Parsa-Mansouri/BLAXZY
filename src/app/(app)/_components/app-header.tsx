"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, LogOut, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Badge, HelpTip, Popover, PopoverClose } from "@/ui";
import { Wordmark } from "@/app/_components/wordmark";

function initialOf(name: string, email: string): string {
  return (name.trim()[0] ?? email[0] ?? "?").toUpperCase();
}

function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Popover
      align="end"
      aria-label="Account menu"
      trigger={
        <button
          type="button"
          aria-label={`Account menu for ${name}`}
          className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text focus-ring transition-colors duration-(--duration-fast) hover:bg-pressed"
        >
          {initialOf(name, email)}
        </button>
      }
    >
      <div className="flex w-64 flex-col gap-1">
        <div className="flex flex-col px-2 pt-1 pb-3">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-sm text-fg-muted">{email}</span>
        </div>
        <PopoverClose
          render={<Link href="/account" />}
          className="flex h-10 items-center gap-2.5 rounded-sm px-2 text-sm text-fg focus-ring hover:bg-hover [&_svg]:size-4 [&_svg]:text-fg-subtle"
        >
          <UserRound aria-hidden="true" />
          Account
        </PopoverClose>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="flex h-10 items-center gap-2.5 rounded-sm px-2 text-left text-sm text-fg focus-ring hover:bg-hover disabled:opacity-60 [&_svg]:size-4 [&_svg]:text-fg-subtle"
        >
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </Popover>
  );
}

export function AppHeader({ name, email }: { name: string; email: string }) {
  return (
    <header className="sticky top-0 z-(--z-sticky) border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-(--gutter)">
        <Wordmark href="/dashboard" />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Badge tone="neutral" icon={<Coins aria-hidden="true" />}>
              0 credits
            </Badge>
            <HelpTip title="Credits" label="What are credits?" side="bottom">
              Credits pay for generating images, video and voices. You will see your balance here
              once you start generating.
            </HelpTip>
          </div>
          <UserMenu name={name} email={email} />
        </div>
      </div>
    </header>
  );
}
