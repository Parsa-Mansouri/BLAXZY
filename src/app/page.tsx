import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Button } from "@/ui";
import { Wordmark } from "./_components/wordmark";

/** Public landing: the wordmark, one line saying what BLAXZY is, and the two ways in. */
export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh flex-col items-center px-(--content-x) pt-[clamp(4rem,30vh,18rem)] pb-16 text-center">
      <Wordmark />
      <p className="mt-6 max-w-[34ch] text-title-3 font-regular text-balance text-label-2">
        Make a film from an idea or a script, one guided stage at a time.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Button variant="prominent" size="large" render={<Link href="/signup" />}>
          Create Account
        </Button>
        <Button variant="standard" size="large" render={<Link href="/login" />}>
          Sign In
        </Button>
      </div>
    </main>
  );
}
