import type { ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/ui";

/** An inline result line under a form: an error (announced at once) or a quiet confirmation. */
export function FormMessage({
  tone,
  children,
  className,
}: {
  tone: "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-1.5 text-callout",
        tone === "error" ? "text-red" : "text-label-2",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-(--icon-sm) shrink-0", tone === "success" && "text-green")}
      />
      <span>{children}</span>
    </div>
  );
}
