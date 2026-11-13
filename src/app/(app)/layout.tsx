import { cookies } from "next/headers";
import { requireUser } from "@/server/auth";
import { AppShell } from "./_components/app-shell";
import { SIDEBAR_COOKIE } from "./_lib/sidebar-cookie";

/**
 * The signed-in window: the floating library sidebar and the content. The `sidebar` slot shows
 * the library everywhere; inside a project it selects that project's row, and the project's
 * stages appear as a strip in the project toolbar instead.
 */
export default async function AppLayout({
  children,
  sidebar,
}: {
  children: React.ReactNode;
  sidebar: React.ReactNode;
}) {
  // The cookie read does not depend on the user; requireUser still gates the whole window.
  const [, cookieStore] = await Promise.all([requireUser(), cookies()]);
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed";
  return (
    <AppShell sidebar={sidebar} defaultCollapsed={collapsed}>
      {children}
    </AppShell>
  );
}
