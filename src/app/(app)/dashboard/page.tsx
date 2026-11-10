import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { DEFAULT_PAGE_SIZE, listProjects } from "@/server/projects";
import { DashboardView } from "./_components/dashboard-view";
import { toSummary } from "./_lib/summary";

export const metadata: Metadata = { title: "Dashboard · BLAXZY" };

export default async function DashboardPage() {
  const user = await requireUser();
  const page = await listProjects({ ownerId: user.id, limit: DEFAULT_PAGE_SIZE });
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  return (
    <DashboardView
      firstName={firstName}
      initialItems={page.items.map(toSummary)}
      initialCursor={page.nextCursor}
    />
  );
}
