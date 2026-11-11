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
    <>
      <a
        href="#main-content"
        className="sr-only z-(--z-tooltip) rounded-capsule bg-accent px-4 py-2 text-headline text-on-accent focus-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to Content
      </a>
      <SplitView
        sidebar={sidebar}
        defaultCollapsed={defaultCollapsed}
        cookieName={SIDEBAR_COOKIE}
        navigationKey={pathname}
      >
        <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {children}
        </main>
      </SplitView>
    </>
  );
}
