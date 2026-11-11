import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = { title: "New Project · BLAXZY" };

export default async function NewProjectPage() {
  await requireUser();
  return <NewProjectForm />;
}
