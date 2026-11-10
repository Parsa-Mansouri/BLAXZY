import { Wordmark } from "@/app/_components/wordmark";

/** Sign-in pages: the wordmark and one narrow column, set high on the page rather than floating. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-(--content-x) pt-[clamp(2.5rem,13vh,8rem)] pb-16">
      <Wordmark className="mb-12" />
      <div className="w-full max-w-(--form-w)">{children}</div>
    </main>
  );
}
