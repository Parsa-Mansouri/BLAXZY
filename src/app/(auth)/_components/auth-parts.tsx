import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/app/_components/wordmark";
import { cn } from "@/ui";

/**
 * One sign-in screen: the hero panel (wordmark, the title rising line by
 * line, the rule, one sentence) beside the form column. `title` is one string per line; fixed
 * words are set in capitals. Changing the title replays the entrance, so state swaps (check your
 * email) feel like a new screen.
 */
export function AuthScreen({
  title,
  description,
  label,
  children,
}: {
  title: string[];
  description?: ReactNode;
  /** Accessible name of the form column. */
  label: string;
  children: ReactNode;
}) {
  const lastLine = title.length - 1;
  return (
    <div key={title.join(" ")} className="contents">
      <section aria-label="BLAXZY" className="flex min-w-0 flex-[3_1_480px] p-3">
        <div className="flex min-h-80 flex-1 flex-col justify-between gap-16 rounded-block bg-hero p-5 sm:p-10">
          <div className="flex flex-col gap-10">
            <div>
              <Wordmark />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="-ml-[0.04em] text-hero-title text-balance break-words uppercase">
              {title.map((line, index) => (
                <span key={line} className="rise-mask">
                  <span className="rise" style={{ animationDelay: `${index * 90}ms` }}>
                    {line}
                  </span>
                </span>
              ))}
            </h1>
            <div
              aria-hidden="true"
              className="mt-3 h-[3px] w-12 rule-in rounded-capsule bg-brand"
              style={{ animationDelay: `${180 + lastLine * 90}ms` }}
            />
            {description ? (
              <p className="mt-3 max-w-(--measure) in-1 text-body text-pretty text-label-2">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </section>
      <main
        aria-label={label}
        className="flex min-w-0 flex-[2_1_400px] flex-col justify-center px-5 py-12 sm:px-[clamp(20px,5vw,64px)]"
      >
        <div className="flex w-full max-w-(--form-w) flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}

/** Quiet text under the form's button. */
export function AuthLinks({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 text-secondary text-label-2", className)}>
      {children}
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-row text-brand underline underline-offset-4 focus-ring hover:text-label"
    >
      {children}
    </Link>
  );
}
