"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { HelpTip, Menu, MenuItem, MenuLabel, MenuSeparator, cn } from "@/ui";
import { usePolling } from "../projects/[id]/_lib/use-polling";
import { useCreditsState } from "../_lib/credits";
import { creditBalanceAction } from "../_lib/credits-actions";
import { useSignOut } from "../_lib/use-sign-out";

/** While a spending screen is open: how often the balance is read. */
const WATCH_POLL_MS = 4000;
/** After an action: read again then, for the job that reserves or refunds the credits. */
const AFTER_ACTION_MS = [0, 1500, 4000];

/**
 * The balance shown: the server's figure on every render, kept current between navigations by
 * polling while a spending screen is open and by reading it after each spending action.
 */
function useLiveCredits(initial: number): number {
  const [credits, setCredits] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCredits(initial);
  }
  const { watchers, requests } = useCreditsState();

  const read = async (isActive: () => boolean = () => true) => {
    const balance = await creditBalanceAction();
    if (isActive()) setCredits(balance);
  };
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });

  usePolling(read, watchers > 0, WATCH_POLL_MS);

  useEffect(() => {
    if (requests === 0) return;
    let alive = true;
    const timers = AFTER_ACTION_MS.map((ms) =>
      window.setTimeout(() => void readRef.current(() => alive).catch(() => {}), ms),
    );
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [requests]);

  return credits;
}

const creditFormat = new Intl.NumberFormat("en-US");

function formatCredits(credits: number): string {
  return `${creditFormat.format(credits)} ${credits === 1 ? "Credit" : "Credits"}`;
}

function initialOf(name: string, email: string): string {
  return (name.trim()[0] ?? email[0] ?? "?").toUpperCase();
}

/** Bottom of the sidebar: the account row (opens the account menu) and the credits line. */
export function SidebarAccount({
  name,
  email,
  credits,
}: {
  name: string;
  email: string;
  /** The account's credit balance. */
  credits: number;
}) {
  const pathname = usePathname();
  const { signOut, pending } = useSignOut();
  const balance = useLiveCredits(credits);
  const onAccount = pathname === "/account";

  return (
    <>
      <Menu
        side="top"
        align="start"
        trigger={
          <button
            type="button"
            aria-label={`Account: ${name}`}
            className={cn(
              "flex min-h-(--sidebar-row-h) w-full items-center gap-2 rounded-control px-2 text-left text-body text-label focus-ring",
              onAccount ? "bg-selection" : "hover:bg-fill-4 data-[popup-open]:bg-fill-4",
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-(--avatar) shrink-0 items-center justify-center rounded-full bg-fill text-subheadline font-semibold text-label"
            >
              {initialOf(name, email)}
            </span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <ChevronsUpDown aria-hidden="true" className="size-(--icon-sm) shrink-0 text-label-2" />
          </button>
        }
      >
        <MenuLabel>{email}</MenuLabel>
        <MenuItem render={<Link href="/account" />}>Account</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={signOut} disabled={pending}>
          {pending ? "Signing Out…" : "Sign Out"}
        </MenuItem>
      </Menu>
      <div className="flex items-center gap-1.5 px-2 text-callout text-label-2">
        <span>{formatCredits(balance)}</span>
        <HelpTip title="Credits" label="About Credits" side="top">
          Credits pay for generating images, video and voices. Each generation shows its price
          before it starts; a failed one gives its credits back.
        </HelpTip>
      </div>
    </>
  );
}
