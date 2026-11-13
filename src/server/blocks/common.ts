/** What the blocks services share: the row type, the input error and its parser, ownership. */
import { isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { promptBlock } from "@/server/db/schema";
import { makeParser, UserInputError } from "@/server/errors";
import { findOwnedProject } from "@/server/projects";

export type PromptBlock = typeof promptBlock.$inferSelect;

/** Thrown for input the caller can fix; `message` is safe to show. */
export class BlocksInputError extends UserInputError {
  constructor(message: string) {
    super(message);
    this.name = "BlocksInputError";
  }
}

export const uuid = z.uuid();

export const parse = makeParser(BlocksInputError);

export const current = isNull(promptBlock.supersededAt);

export async function ownedProject(projectId: string, userId: string) {
  return findOwnedProject(getDb(), projectId, userId);
}
