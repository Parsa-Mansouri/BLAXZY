"use client";

import type { ReactNode } from "react";
import { ToastProvider, TooltipProvider } from "@/ui";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}
