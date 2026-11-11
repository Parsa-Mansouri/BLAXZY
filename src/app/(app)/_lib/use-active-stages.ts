"use client";

import { usePathname } from "next/navigation";
import type { StageListItem } from "@/ui";

/** Marks the stage whose route is being shown, so the list highlights where the user is. */
export function useActiveStages(stages: StageListItem[]): StageListItem[] {
  const pathname = usePathname();
  return stages.map((stage) => ({ ...stage, active: stage.href === pathname }));
}
