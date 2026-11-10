import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Button } from "@/ui";
import { Wordmark } from "./_components/wordmark";

export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col px-(--gutter) py-6">
      <header>
        <Wordmark />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
        <div className="flex max-w-xl flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Turn your story into a film
          </h1>
          <p className="text-base text-fg-muted sm:text-lg">
            Describe the look, bring a script, and BLAXZY guides you from idea to finished scenes,
            one clear step at a time.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <Button size="lg" variant="primary" href="/signup">
            Create account
          </Button>
          <Button size="lg" variant="secondary" href="/login">
            Sign in
          </Button>
        </div>
      </div>
    </main>
  );
}
