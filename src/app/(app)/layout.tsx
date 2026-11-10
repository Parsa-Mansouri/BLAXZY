import { cookies } from "next/headers";
import { requireUser } from "@/server/auth";
import { AppShell } from "./_components/app-shell";
import { SIDEBAR_COOKIE } from "./_lib/sidebar-cookie";

/**
 * The signed-in window. The `sidebar` slot shows the library everywhere except inside a project,
 * where it becomes that project's stage list.
 */
export default async function AppLayout({
  children,
  sidebar,
}: {
  children: React.ReactNode;
  sidebar: React.ReactNode;
}) {
  await requireUser();
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  return (
    <AppShell sidebar={sidebar} defaultCollapsed={collapsed}>
      {children}
    </AppShell>
  );
}
