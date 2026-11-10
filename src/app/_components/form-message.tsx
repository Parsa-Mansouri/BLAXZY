import type { ReactNode } from "react";
import { cn } from "@/ui";

/** An inline result message under a form: an error (announced at once) or a calm success. */
export function FormMessage({
  tone,
  children,
  className,
}: {
  tone: "error" | "success";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3 py-2.5 text-sm",
        tone === "error" ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
        className,
      )}
    >
      {children}
    </div>
  );
}
