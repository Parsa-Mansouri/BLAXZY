import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Button } from "@/ui";
import { Wordmark } from "./_components/wordmark";
import { HeroVideo } from "./_landing/hero-video";

/**
 * Public landing: one screen over a full-bleed film. The wordmark and Sign In, the headline,
 * one line about BLAXZY and the way in. Signed-in visitors go straight to the dashboard.
 */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-ground px-(--content-x)">
      <HeroVideo />
      {/* Scrim: keeps the top bar and the headline readable over any frame. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(0_0_0/0.55)_0%,rgb(0_0_0/0)_22%,rgb(0_0_0/0.15)_50%,rgb(0_0_0/0.9)_100%)]"
      />

      <header className="flex h-(--toolbar-h) items-center justify-between gap-6">
        <Wordmark />
        <Button variant="plain" render={<Link href="/login" />}>
          Sign In
        </Button>
      </header>

      <section aria-label="BLAXZY" className="flex flex-1 flex-col justify-end gap-10 pt-16 pb-10">
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
            BLAXZY takes a director from an idea or a script to every generated clip of a film.
          </p>
        </div>
        <div className="in-3">
          <Button variant="primary" size="large" render={<Link href="/signup" />}>
            Create Account
          </Button>
        </div>
      </section>

      <footer className="pb-8">
        <p className="text-secondary text-label-3">© {new Date().getFullYear()} BLAXZY</p>
      </footer>
    </main>
  );
}
