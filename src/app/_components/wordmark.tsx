import Link from "next/link";

/** The BLAXZY wordmark, linking home. */
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="rounded-sm text-lg font-semibold tracking-[0.18em] text-fg focus-ring"
    >
      BLAXZY
    </Link>
  );
}
