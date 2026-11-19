/**
 * Input errors shared by the services. Each module keeps its own class (its name, `instanceof`
 * checks and `error.name` are part of its surface); they all extend `UserInputError`, and their
 * input parsers come from `makeParser`. Pure: no database imports.
 */
import type { z } from "zod";

/**
 * Marks an error whose `message` is written for the user: server actions show it as is and jobs
 * record it without retrying (`isUserFacing`). Each user-facing class sets `userFacing = true`,
 * so there is no list of classes to keep in step.
 */
export interface UserFacing {
  readonly userFacing: true;
}

/** True for an error whose message is safe to show the user (its class sets `userFacing`). */
export function isUserFacing(error: unknown): error is Error & UserFacing {
  return error instanceof Error && (error as Partial<UserFacing>).userFacing === true;
}

/** Thrown for input the user can fix, or a step that is not possible now; `message` is safe to show. */
export class UserInputError extends Error implements UserFacing {
  readonly userFacing = true as const;
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

/**
 * A validator whose failures throw `ErrorClass` with the first issue's message (or "That input is
 * not valid."); on success it returns the parsed (output) value.
 */
export function makeParser(
  ErrorClass: new (message: string) => Error,
): <S extends z.ZodType>(schema: S, input: unknown) => z.output<S> {
  return <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new ErrorClass(result.error.issues[0]?.message ?? "That input is not valid.");
    }
    return result.data;
  };
}
