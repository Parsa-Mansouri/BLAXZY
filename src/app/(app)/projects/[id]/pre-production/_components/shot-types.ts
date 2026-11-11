/** What the Pre-production view shows of a prompt block. */
export interface ShotRow {
  id: string;
  orderIndex: number;
  title: string | null;
  durationSeconds: number | null;
  scriptExcerpt: string;
  prompt: string;
  stale: boolean;
  staleReason: string | null;
}

export const SHOT_PAGE_SIZE = 12;

export function toShotRow(block: ShotRow): ShotRow {
  return {
    id: block.id,
    orderIndex: block.orderIndex,
    title: block.title,
    durationSeconds: block.durationSeconds,
    scriptExcerpt: block.scriptExcerpt,
    prompt: block.prompt,
    stale: block.stale,
    staleReason: block.staleReason,
  };
}
