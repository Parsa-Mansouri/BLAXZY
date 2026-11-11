import type { ReactNode } from "react";
import { PageHeader } from "@/ui";

/** The page header, one sentence and the way out. Shared by every not-found page. */
export function NotFoundView({
  heading,
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
    <section className="flex flex-col">
      <PageHeader as={heading} title={title} description={message} />
      <div className="flex in-2 flex-wrap items-center gap-3">{actions}</div>
    </section>
  );
}
