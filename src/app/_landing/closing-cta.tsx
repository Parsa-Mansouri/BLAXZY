import type { CSSProperties } from "react";
import Link from "next/link";
import { Button, stagger } from "@/ui";
import { Glows } from "./glows";
import { Reveal } from "./reveal";

/** The countdown: each number's delay after the section comes into view. */
const BEATS = [
  { n: 3, at: 0 },
  { n: 2, at: 700 },
  { n: 1, at: 1400 },
] as const;

/**
 * Roll camera: 3, 2, 1 come up in turn, the first two stepping back as the next lands, with the
 * slate it is counting down to. Decorative; the title says it in words.
 */
function Countdown() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <p className="flex items-baseline gap-[0.35em] text-hero-title text-label-2 tabular-nums">
        {BEATS.map(({ n, at }) => (
          <span
            key={n}
            className={n === 1 ? "count-land" : "count-beat"}
            style={{ "--beat": `${at}ms` } as CSSProperties}
          >
            {n}
          </span>
        ))}
      </p>
      <p
        className="count-land mono-value text-meta text-label-3"
        style={{ "--beat": "1700ms" } as CSSProperties}
      >
        E01 · S01 · B01 · TAKE 1
      </p>
    </div>
  );
}

/** The last word: the countdown under two slow lights, the title, and the way in. */
export function ClosingCta() {
  return (
    <section
      aria-label="Get started"
      className="relative isolate flex min-h-[80dvh] flex-col justify-center overflow-hidden px-(--content-x) py-28"
    >
      <Glows />
      <Reveal
        mode="group"
        className="grid items-end gap-16 shell:grid-cols-[minmax(0,1fr)_auto] shell:items-center"
      >
        {/* Narrow: the countdown sits above the title. Wide: on the right, clear of the text. */}
        <div className="shell:order-2 shell:pr-[4vw]">
          <Countdown />
        </div>
        <div className="flex flex-col gap-10 shell:order-1">
          <div className="flex flex-col gap-6">
            <h2 className="-ml-[0.04em] text-hero-title text-balance">
              <span className="rise-mask">
                <span className="rise">Roll camera.</span>
              </span>
              <span className="rise-mask">
                <span className="rise" style={{ animationDelay: "90ms" }}>
                  Your film starts here.
                </span>
              </span>
            </h2>
            <div
              aria-hidden="true"
              className="h-[3px] w-12 rule-in rounded-capsule bg-brand"
              style={{ animationDelay: "320ms" }}
            />
          </div>
          <div className="flex enter flex-wrap items-center gap-3" style={stagger(0, 420)}>
            <Button variant="primary" size="large" render={<Link href="/signup" />}>
              Create Account
            </Button>
            <Button variant="plain" size="large" render={<Link href="/login" />}>
              Sign In
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
