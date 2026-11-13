import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Button } from "@/ui";
import { ClipVsFilm } from "./_landing/ClipVsFilm";
import { ClosingCta } from "./_landing/ClosingCta";
import { Faq } from "./_landing/Faq";
import { Footer } from "./_landing/Footer";
import { Glows } from "./_landing/Glows";
import { LandingNav } from "./_landing/LandingNav";
import { Split } from "./_landing/Split";
import { StageReel } from "./_landing/StageReel";
import { Timecode } from "./_landing/Timecode";
import { HeroStack } from "./_landing/vignettes";

/**
 * Public landing (Landing.dc.html): the headline and the way in, one clip versus the film,
 * the four stages, who decides what, questions, and a last call to start.
 */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col bg-ground">
      <LandingNav />
      <section
        aria-label="BLAXZY"
        className="relative isolate flex min-h-dvh flex-col gap-16 overflow-hidden px-(--content-x) pt-(--toolbar-h) pb-24"
      >
        <Glows />

        <div className="grid flex-1 items-center gap-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:py-10">
          <div className="flex min-w-0 flex-col gap-10">
            <div className="flex flex-col gap-6">
              <h1 className="-ml-[0.04em] text-hero-title text-balance">
                <span className="rise-mask">
                  <span className="rise">From an idea</span>
                </span>
                <span className="rise-mask">
                  <span className="rise" style={{ animationDelay: "90ms" }}>
                    to every clip.
                  </span>
                </span>
              </h1>
              <div
                aria-hidden="true"
                className="h-[3px] w-12 rule-in rounded-capsule bg-brand"
                style={{ animationDelay: "320ms" }}
              />
              <p className="font-normal max-w-(--measure) in-2 text-row text-pretty text-label-2">
                BLAXZY takes a director from an idea or a script to every generated clip of a film,
                and makes the technical choices for them.
              </p>
            </div>
            <div className="flex in-3 flex-col items-start gap-6">
              <Button variant="primary" size="large" render={<Link href="/signup" />}>
                Create Account
              </Button>
              <Timecode className="mono-value text-meta text-label-3" />
            </div>
          </div>
          {/* Wide screens: the product itself, beside the headline. */}
          <HeroStack className="hidden max-w-[33rem] justify-self-end lg:flex" />
        </div>

        <a
          href="#stages"
          className="absolute bottom-6 left-(--content-x) flex in-3 items-center gap-3 rounded-nested text-label-3 focus-ring transition-colors duration-(--dur-press) hover:text-label"
        >
          <span aria-hidden="true" className="h-8 w-px overflow-hidden">
            <span className="block size-full scroll-cue bg-label-3" />
          </span>
          <span className="caps-label">Scroll</span>
        </a>
      </section>

      <ClipVsFilm />
      <StageReel />
      <Split />
      <Faq />
      <ClosingCta />
      <Footer />
    </main>
  );
}
