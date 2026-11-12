"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarItem } from "@/ui";

function initialOf(name: string, email: string): string {
  return (name.trim()[0] ?? email[0] ?? "?").toUpperCase();
}

/**
 * Foot of the sidebar: the Account row with the user's initial. It opens the Account page,
 * where the details, the credits and Sign Out live.
 */
export function SidebarAccount({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  return (
    <ul>
      <SidebarItem
        selected={pathname === "/account"}
        render={<Link href="/account" />}
        aria-label={`Account: ${name || email}`}
        className="min-h-11 text-secondary"
        icon={
          <span
            aria-hidden="true"
            className="flex size-(--avatar) items-center justify-center rounded-full bg-fill-2 text-meta font-semibold text-label"
          >
            {/* Centred by its cap height, not its line box. */}
            <span className="optical-center">{initialOf(name, email)}</span>
          </span>
        }
      >
        Account
      </SidebarItem>
    </ul>
  );
}
