import type { Metadata } from "next";
import Link from "next/link";
import { Button, Toolbar } from "@/ui";
import { NotFoundView } from "../_components/not-found-view";

export const metadata: Metadata = { title: "Page Not Found · BLAXZY" };

/** Inside the signed-in window: a page or project that is missing or belongs to someone else. */
export default function AppNotFound() {
  return (
    <>
      {/* Also when a layout's metadata stopped at notFound(), as for a project that is not there. */}
      <title>Page Not Found · BLAXZY</title>
      <Toolbar />
      <div className="px-(--content-x) pt-8 pb-18">
        <NotFoundView
          heading="h1"
          title="This Page Is Not in Your Account"
          message="It does not exist, or it belongs to someone else. Your films are in Projects."
          actions={
            <Button variant="primary" size="large" render={<Link href="/projects" />}>
              Projects
            </Button>
          }
        />
      </div>
    </>
  );
}
