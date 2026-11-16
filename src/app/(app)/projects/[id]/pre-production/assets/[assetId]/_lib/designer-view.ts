import type { DesignerKey, ReferenceRoleChoice } from "@/server/damis";

/**
 * What the asset screen needs to know about the designer that draws the asset (character,
 * location or prop): the roles a reference photo can take and the point where a review suggests
 * describing the change exactly. The page reads it from `@/server/damis` and hands it down as
 * plain data; null for voices.
 */
export interface DesignerInfo {
  key: DesignerKey;
  /** Rejected images in a row after which the screen suggests describing it exactly. */
  maxAttempts: number;
  /** What the catalog says after that many attempts; null when it says nothing. */
  attemptMessage: string | null;
  roles: readonly ReferenceRoleChoice[];
  /** At most this many reference photos per design. */
  maxReferences: number;
  /** The answer that means "I'm not sure" (the designer then decides). */
  aiDecides: string;
}
