"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/ui";
import { NotFoundView } from "@/app/_components/not-found-view";

/** A missing asset, category or stage inside a project that does exist. */
export default function ProjectNotFound() {
  const projectId = usePathname().split("/")[2];
  return (
    <>
      {/* A client not-found cannot export metadata; React places the title in the head. */}
      <title>Page Not Found · BLAXZY</title>
      <NotFoundView
        heading="h1"
        message="This part of the project does not exist."
        actions={
          <>
            {projectId ? (
              <Button
                variant="primary"
                size="large"
                render={<Link href={`/projects/${projectId}`} />}
              >
                Back to Project
              </Button>
            ) : null}
            <Button variant="outlined" size="large" render={<Link href="/projects" />}>
              Projects
            </Button>
          </>
        }
      />
    </>
  );
}
