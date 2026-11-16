import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { CallSheet } from "./_landing/call-sheet";
import { AuthButton } from "./_landing/credit-button";
import { FitWord } from "./_landing/fit-word";
import { LoopVideo } from "./_landing/loop-video";
import { Pricing } from "./_landing/pricing";

/**
 * Public landing, built from the wordmark: the rooftop film with BLAXZY set edge to edge, then
 * the four stages as a large stage strip, the plans as slates, and an end card. Signed-in visitors go straight to the dashboard.
 */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex flex-col overflow-x-clip bg-ground">
      <section
        aria-label="BLAXZY"
        className="relative isolate flex h-dvh min-h-[32rem] flex-col overflow-hidden"
      >
        <LoopVideo
          src="/landing/hero.mp4"
          poster="/landing/hero.jpg"
          className="absolute inset-0 -z-10 size-full object-cover object-[30%_center]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgb(0_0_0/0.35)_0%,rgb(0_0_0/0)_20%,rgb(0_0_0/0)_55%,rgb(0_0_0/0.7)_100%)]"
        />

        <header className="flex h-(--toolbar-h) items-center justify-end px-(--content-x)">
          <Link
            href="/login"
            className="credit rounded-nested text-label-2 focus-ring transition-colors duration-(--dur-press) hover:text-label"
          >
            Sign In
          </Link>
        </header>

        <h1 className="mt-auto px-(--content-x) pb-8 sm:pb-10">
          <FitWord word="BLAXZY" className="text-label" />
        </h1>
      </section>

      <CallSheet />
      <Pricing />

      <footer className="flex flex-col gap-10 px-(--content-x) pt-24 pb-10">
        <FitWord word="BLAXZY" className="text-fill-2" />
        <div className="flex flex-wrap items-center justify-between gap-6">
          <p className="credit text-label-3">© {new Date().getFullYear()} BLAXZY</p>
          <AuthButton />
        </div>
      </footer>
    </main>
  );
}
