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

/** Public landing (Landing.dc.html): the hero with its two slow lights, then the four stages. */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col bg-ground">
      <section
        aria-label="BLAXZY"
        className="relative flex min-h-[600px] flex-1 flex-col justify-between gap-16 overflow-hidden px-[clamp(20px,5vw,40px)] pt-8 pb-16"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-42%] left-[8%] aspect-square w-[58%] glow-a rounded-full blur-[30px]"
          style={{
            background: "radial-gradient(closest-side, rgba(255,255,255,.17), rgba(255,255,255,0))",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-10%] bottom-[-60%] aspect-square w-[66%] glow-b rounded-full blur-[40px]"
          style={{
            background: "radial-gradient(closest-side, rgba(255,255,255,.11), rgba(255,255,255,0))",
          }}
        />

        <header className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Wordmark />
          <Button variant="plain" render={<Link href="/login" />}>
            Sign In
          </Button>
        </header>

        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-6">
            <h1 className="text-[clamp(40px,8.4vw,120px)] leading-[0.96] font-semibold tracking-[-0.05em] break-words">
              <span className="rise-mask">
                <span className="rise">From an idea</span>
              </span>
              <span className="rise-mask" style={{ paddingBottom: "0.14em" }}>
                <span className="rise" style={{ animationDelay: "90ms" }}>
                  to every clip.
                </span>
              </span>
            </h1>
            <div
              aria-hidden="true"
              className="h-[3px] w-12 rule-in rounded-capsule bg-accent"
              style={{ animationDelay: "320ms" }}
            />
            <p className="max-w-[600px] in-2 text-[17px] leading-[26px] text-label-2">
              BLAXZY takes a director from an idea or a script to every generated clip of a film,
              and makes the technical choices for them.
            </p>
          </div>
          <div className="flex in-3 flex-wrap items-center gap-3">
            <Button variant="primary" size="large" render={<Link href="/signup" />}>
              Create Account
            </Button>
            <Button
              variant="outlined"
              size="large"
              className="border-outline-hero"
              render={<Link href="/login" />}
            >
              Sign In
            </Button>
          </div>
        </div>
      </section>

      <section
        aria-label="The four stages of a film"
        className="in-3 px-[clamp(20px,5vw,40px)] pt-8 pb-12 hairline-t"
      >
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-y-8">
          {PROJECT_STAGES.map((stage, index) => (
            <li
              key={stage.key}
              className="flex enter flex-col gap-2 border-l border-separator pr-6 pl-5"
              style={stagger(index, 460)}
            >
              <h2 className="caps-label text-label">{stage.label}</h2>
              <p className="text-secondary text-label-2">{STAGE_COPY[stage.key]}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
