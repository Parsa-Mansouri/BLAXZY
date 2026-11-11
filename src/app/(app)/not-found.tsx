import type { Metadata } from "next";
import Link from "next/link";
import { Button, Toolbar } from "@/ui";
import { NotFoundView } from "../_components/not-found-view";

export const metadata: Metadata = { title: "Page Not Found · BLAXZY" };

/** Inside the signed-in window: a page or project that is missing or belongs to someone else. */
export default function AppNotFound() {
  return (
    <>
      <Toolbar title="Not Found" />
      <div className="px-(--content-x) pt-4 pb-16 shell:pt-8">
        <NotFoundView
          heading="h2"
          message="This page does not exist, or it is not in your account."
          actions={
            <Button variant="prominent" size="large" render={<Link href="/projects" />}>
              Projects
            </Button>
          }
        />
      </div>
    </>
  );
}
