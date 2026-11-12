import type { DesignerKey, ReferenceRoleChoice, ReviewOption } from "@/server/damis";

/**
 * What the asset screen needs to know about the designer that draws the asset (character,
 * location or prop): its review catalog as the Wizard shows it, the roles a reference photo can
 * take, which changes contradict which photo roles, and the frames of a character board. The page
 * reads it from `@/server/damis` and hands it down as plain data; null for voices.
 */
export interface DesignerInfo {
  key: DesignerKey;
  /** The review catalog's options visible in the Wizard, in catalog order. */
  options: ReviewOption[];
  /** The catalog's groups (props: Framing, Studio, Form ...), in order. */
  groups: { id: string; label: string }[];
  /** Rejected images in a row after which the screen suggests describing it exactly. */
  maxAttempts: number;
  /** What the catalog says after that many attempts; null when it says nothing. */
  attemptMessage: string | null;
  roles: readonly ReferenceRoleChoice[];
  /** Location and prop preference codes → the reference roles they contradict. */
  conflicts: Readonly<Record<string, readonly string[]>>;
  /** Where on a character board a change applies (empty for locations and props). */
  frames: readonly { id: string; label: string }[];
  /** At most this many reference photos per design. */
  maxReferences: number;
  /** The answer that means "I'm not sure" (the designer then decides). */
  aiDecides: string;
}
