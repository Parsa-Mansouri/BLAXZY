import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/ui";

/** The page title and an optional sentence under it. */
export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <h1 className="text-large-title">{title}</h1>
      {children ? <p className="text-reading text-balance text-label-2">{children}</p> : null}
    </div>
  );
}

/** Quiet text links under the form. */
export function AuthLinks({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 text-body text-label-2", className)}>
      {children}
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-control text-label underline-offset-4 focus-ring hover:underline"
    >
      {children}
    </Link>
  );
}
