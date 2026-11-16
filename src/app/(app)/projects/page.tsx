import { redirect } from "next/navigation";

/** The films are on Home: the old Projects page leads there. */
export default function ProjectsPage() {
  redirect("/dashboard");
}
