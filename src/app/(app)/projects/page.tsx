import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { DEFAULT_PAGE_SIZE, listProjects } from "@/server/projects";
import { toSummary } from "../dashboard/_lib/summary";
import { AllProjectsView } from "./_components/all-projects-view";

export const metadata: Metadata = { title: "All Projects · BLAXZY" };

export default async function AllProjectsPage() {
  const user = await requireUser();
  const page = await listProjects({ ownerId: user.id, limit: DEFAULT_PAGE_SIZE });
  return (
    <AllProjectsView initialItems={page.items.map(toSummary)} initialCursor={page.nextCursor} />
  );
}
