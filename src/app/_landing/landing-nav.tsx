"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, cn } from "@/ui";
import { Wordmark } from "../_components/wordmark";

const navLink =
  "caps-label rounded-nested text-label-2 transition-colors duration-(--dur-press) hover:text-label focus-ring";

/**
 * The sticky top nav. Clear over the hero; once the page scrolls past the sentinel at its top
 * it picks up a blurred ground and a hairline.
 */
export function LandingNav() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setScrolled(!entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-2"
      />
      <header
        data-scrolled={scrolled ? "" : undefined}
        className={cn(
          "sticky top-0 z-(--z-toolbar) -mb-(--toolbar-h) flex h-(--toolbar-h) items-center justify-between gap-6 px-(--content-x)",
          "transition-[background-color,box-shadow,backdrop-filter] duration-(--dur-swap) ease-(--ease-curve)",
          "data-[scrolled]:bg-[color-mix(in_srgb,var(--ground)_80%,transparent)] data-[scrolled]:hairline-b data-[scrolled]:backdrop-blur-md",
        )}
      >
        <div className="flex items-center gap-10">
          <Wordmark />
          <nav aria-label="Page" className="hidden items-center gap-7 shell:flex">
            <a href="#stages" className={navLink}>
              Stages
            </a>
            <a href="#faq" className={navLink}>
              FAQ
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="plain" render={<Link href="/login" />}>
            Sign In
          </Button>
          <Button variant="primary" size="small" render={<Link href="/signup" />}>
            Create Account
          </Button>
        </div>
      </header>
    </>
  );
}
