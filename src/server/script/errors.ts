import { UserInputError } from "@/server/errors";

export class ScriptInputError extends UserInputError {
  constructor(message: string) {
    super(message);
    this.name = "ScriptInputError";
  }
}
