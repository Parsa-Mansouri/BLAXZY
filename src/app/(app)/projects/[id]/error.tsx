"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/ui";
import { RouteError } from "@/app/_components/route-states";

/** An unexpected failure on a page inside a project. The toolbar and stage strip stay usable. */
export default function ProjectError({ error, retry }: { error: unknown; retry: () => void }) {
  const projectId = usePathname().split("/")[2];
  return (
    <RouteError
      error={error}
      retry={retry}
      title="This Part of the Project Could Not Be Shown"
      message="Try again. If it keeps failing, go back to the project."
      way={
        <Button
          variant="outlined"
          size="large"
          render={<Link href={projectId ? `/projects/${projectId}` : "/projects"} />}
        >
          {projectId ? "Back to Project" : "Projects"}
        </Button>
      }
    />
  );
}
