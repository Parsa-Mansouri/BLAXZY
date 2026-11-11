"use client";

import { usePathname } from "next/navigation";

/**
 * Marks the stage whose screen is being shown: its own route or any page below it, so
 * `/projects/x/pre-production/characters` still marks Pre-production.
 */
export function useActiveStages<T extends { href?: string }>(
  stages: T[],
): (T & { active: boolean })[] {
  const pathname = usePathname();
  return stages.map((stage) => ({
    ...stage,
    active: Boolean(
      stage.href && (pathname === stage.href || pathname.startsWith(`${stage.href}/`)),
    ),
  }));
}
