import Link from "next/link";
import { Button } from "@/ui";
import { Wordmark } from "../_components/wordmark";

export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 px-(--content-x) py-8 hairline-t">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-1">
          <Button variant="plain" render={<Link href="/login" />}>
            Sign In
          </Button>
          <Button variant="plain" render={<Link href="/signup" />}>
            Create Account
          </Button>
        </nav>
        <p className="text-secondary text-label-3">© {new Date().getFullYear()} BLAXZY</p>
      </div>
      <p aria-hidden="true" className="mono-value text-meta text-label-3">
        END OF REEL
      </p>
    </footer>
  );
}
