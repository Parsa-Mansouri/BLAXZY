import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/ui";
import { NotFoundView } from "./_components/not-found-view";
import { Wordmark } from "./_components/wordmark";

export const metadata: Metadata = { title: "Page Not Found · BLAXZY" };

/** Any address that matches no page, seen signed out or outside the signed-in window. */
export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-start gap-16 px-(--content-x) pt-[clamp(2.5rem,13vh,8rem)] pb-18">
      <Wordmark />
      <NotFoundView
        heading="h1"
        message="This address does not lead to a page. Check it, or start from the beginning."
        actions={
          <Button variant="primary" size="large" render={<Link href="/" />}>
            Home
          </Button>
        }
      />
    </main>
  );
}
