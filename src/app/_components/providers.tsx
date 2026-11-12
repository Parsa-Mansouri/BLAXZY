"use client";

import type { ReactNode } from "react";
import { LucideProvider } from "lucide-react";
import { ToastProvider, TooltipProvider } from "@/ui";

/** App-wide providers. Every lucide icon defaults to the kit's stroke of 1.5. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LucideProvider strokeWidth={1.5}>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </LucideProvider>
  );
}
