import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** The way back one level: a quiet chevron and the name of where it leads. */
export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="-ml-1.5 inline-flex w-fit items-center gap-0.5 rounded-control px-1.5 py-0.5 text-body text-label-2 focus-ring hover:text-label"
    >
      <ChevronLeft aria-hidden className="size-(--icon)" />
      {children}
    </Link>
  );
}
