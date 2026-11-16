import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/ui";

/**
 * The landing's call to action, set like a credit: a square-cornered white outline that fills
 * white on hover.
 */
export function CreditButton({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-12 items-center justify-center border border-label px-9 text-label focus-ring",
        "transition-[background-color,color,transform] duration-(--dur-press) ease-(--ease-curve)",
        "hover:bg-label hover:text-ground active:scale-[0.98]",
        className,
      )}
    >
      <span className="credit">{children}</span>
    </Link>
  );
}

const half =
  "flex h-full items-center px-5 text-label focus-ring transition-colors duration-(--dur-press) hover:bg-label hover:text-ground";

/** Sign In and Create Account as one outlined button, split by a hairline. */
export function AuthButton({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Account"
      className={cn(
        "inline-flex h-10 items-stretch border border-label bg-ground/30 backdrop-blur-md",
        className,
      )}
    >
      <Link href="/login" className={half}>
        <span className="credit">Sign In</span>
      </Link>
      <span aria-hidden="true" className="w-px bg-label" />
      <Link href="/signup" className={half}>
        <span className="credit">Create Account</span>
      </Link>
    </nav>
  );
}
