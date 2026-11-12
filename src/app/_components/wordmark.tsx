import Link from "next/link";
import { cn } from "@/ui";

/** The BLAXZY wordmark: wide-tracked capitals, linking home. */
export function Wordmark({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="BLAXZY, home"
      className={cn("rounded-nested text-wordmark text-label focus-ring", className)}
    >
      BLAXZY
    </Link>
  );
}
