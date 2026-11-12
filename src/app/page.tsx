import Link from "next/link";
import { redirect } from "next/navigation";
import { PROJECT_STAGES } from "@/lib/stages";
import { getSession } from "@/server/auth";
import { Button, stagger } from "@/ui";
import { Wordmark } from "./_components/wordmark";

/** What each stage promises, in the words of Landing.dc.html. */
const STAGE_COPY: Record<string, string> = {
  style: "Choose how the film should look before anything else is made.",
  script: "Start from an idea or bring your own script, then read it scene by scene.",
  pre_production: "Review every character, location, prop and voice before a scene is generated.",
  production: "Each scene becomes clips. Keep the takes you like and redo the rest.",
};

/**
 * Public landing (Landing.dc.html): the headline and the way in,
 * then the four stages.
 */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col bg-ground">
      <section
        aria-label="BLAXZY"
        className="flex flex-1 flex-col gap-16 px-(--content-x) pt-8 pb-16"
      >
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Wordmark />
          <Button variant="plain" render={<Link href="/login" />}>
            Sign In
          </Button>
        </header>

        <div className="flex flex-1 flex-col justify-center">
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
            <div className="flex in-3 flex-wrap items-center gap-3">
              <Button variant="primary" size="large" render={<Link href="/signup" />}>
                Create Account
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="The four stages of a film" className="in-3 px-(--content-x) pt-8 pb-16">
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-12 gap-y-10">
          {PROJECT_STAGES.map((stage, index) => (
            <li key={stage.key} className="flex enter flex-col gap-2" style={stagger(index, 460)}>
              <h2 className="caps-label text-label">{stage.label}</h2>
              <p className="text-secondary text-pretty text-label-2">{STAGE_COPY[stage.key]}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
