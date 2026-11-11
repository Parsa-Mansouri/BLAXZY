"use client";

import Link from "next/link";
import { Button } from "@/ui";
import { RouteError } from "../_components/route-states";

/** An unexpected failure on a signed-in page. The sidebar stays usable. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="px-(--content-x) pt-(--toolbar-h) pb-18">
      <RouteError
        error={error}
        retry={retry}
        way={
          <Button variant="outlined" size="large" render={<Link href="/projects" />}>
            Projects
          </Button>
        }
      />
    </div>
  );
}
