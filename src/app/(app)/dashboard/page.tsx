import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { DEFAULT_PAGE_SIZE, listProjects } from "@/server/projects";
import { DashboardView } from "./_components/dashboard-view";
import { toSummary } from "./_lib/summary";

export const metadata: Metadata = { title: "Home · BLAXZY" };

export default async function DashboardPage() {
  const user = await requireUser();
  const page = await listProjects({ ownerId: user.id, limit: DEFAULT_PAGE_SIZE });
  return <DashboardView initialItems={page.items.map(toSummary)} initialCursor={page.nextCursor} />;
}
