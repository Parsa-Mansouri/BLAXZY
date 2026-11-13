/** The current blocks of a project, keyset-paginated. */
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { promptBlock } from "@/server/db/schema";
import { decodeOrderCursor, encodeOrderCursor } from "@/server/projects/cursor";
import { BlocksInputError, current, ownedProject, parse, type PromptBlock } from "./common";

export const DEFAULT_BLOCK_PAGE_SIZE = 50;

export const MAX_BLOCK_PAGE_SIZE = 200;

const listBlocksSchema = z.object({
  limit: z.number().int().min(1).max(MAX_BLOCK_PAGE_SIZE).default(DEFAULT_BLOCK_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

function decodeCursor(cursor: string): { orderIndex: number; id: string } {
  const decoded = decodeOrderCursor(cursor);
  if (!decoded) throw new BlocksInputError("That page link is no longer valid. Reload the list.");
  return decoded;
}

/** The project's current blocks in story order, keyset-paginated. */
export async function listBlocks(
  projectId: string,
  userId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: PromptBlock[]; nextCursor: string | null } | null> {
  const { limit, cursor } = parse(listBlocksSchema, opts);
  if (!(await ownedProject(projectId, userId))) return null;
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await getDb()
    .select()
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.projectId, projectId),
        current,
        after
          ? sql`(${promptBlock.orderIndex}, ${promptBlock.id}) > (${after.orderIndex}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(promptBlock.orderIndex), asc(promptBlock.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeOrderCursor(last.orderIndex, last.id) : null,
  };
}
