import { z } from "zod";

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 12;
export const MAX_TITLE_LENGTH = 120;

export const titleSchema = z
  .string({ error: "Give your project a title." })
  .trim()
  .min(1, "Give your project a title.")
  .max(MAX_TITLE_LENGTH, `Keep the title under ${MAX_TITLE_LENGTH} characters.`);

export const uuidSchema = z.uuid();

export const createProjectSchema = z.object({ ownerId: z.string().min(1), title: titleSchema });
export const renameProjectSchema = z.object({
  projectId: z.string(),
  ownerId: z.string().min(1),
  title: titleSchema,
});
export const archiveProjectSchema = z.object({ projectId: z.string(), ownerId: z.string().min(1) });
export const listProjectsSchema = z.object({
  ownerId: z.string().min(1),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

/** Thrown for input the user can fix; `message` is safe to show. */
export class ProjectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectInputError";
  }
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ProjectInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}
