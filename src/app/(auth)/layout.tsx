import { Wordmark } from "@/app/_components/wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-(--gutter) py-8 sm:justify-center">
      <div className="mb-8 sm:mb-10">
        <Wordmark />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
