"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SplitView } from "@/ui";
import { SIDEBAR_COOKIE } from "../_lib/sidebar-cookie";

export function AppShell({
  sidebar,
  defaultCollapsed,
  children,
}: {
  sidebar: ReactNode;
  defaultCollapsed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <SplitView
      sidebar={sidebar}
      defaultCollapsed={defaultCollapsed}
      cookieName={SIDEBAR_COOKIE}
      navigationKey={pathname}
    >
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </SplitView>
  );
}
