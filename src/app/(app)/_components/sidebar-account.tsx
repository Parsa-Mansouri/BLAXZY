"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { HelpTip, Menu, MenuItem, MenuLabel, MenuSeparator, cn } from "@/ui";
import { useSignOut } from "../_lib/use-sign-out";

function initialOf(name: string, email: string): string {
  return (name.trim()[0] ?? email[0] ?? "?").toUpperCase();
}

/** Bottom of the sidebar: the account row (opens the account menu) and the credits line. */
export function SidebarAccount({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  const { signOut, pending } = useSignOut();
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
        <span>0 Credits</span>
        <HelpTip title="Credits" label="About Credits" side="top">
          Credits pay for generating images, video and voices. The balance appears here once
          generation is available.
        </HelpTip>
      </div>
    </>
  );
}
