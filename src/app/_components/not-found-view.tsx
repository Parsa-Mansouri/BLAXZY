import type { ReactNode } from "react";

/** A short title, one sentence and the way out. Shared by every not-found page. */
export function NotFoundView({
  heading: Heading,
  title = "Page Not Found",
  message,
  actions,
}: {
  heading: "h1" | "h2";
  title?: string;
  message: string;
  actions: ReactNode;
}) {
  return (
    <section className="flex max-w-(--measure) flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading className="text-large-title text-balance">{title}</Heading>
        <p className="text-reading text-pretty text-label-2">{message}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">{actions}</div>
    </section>
  );
}
