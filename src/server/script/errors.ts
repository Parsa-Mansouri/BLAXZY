export class ScriptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptInputError";
  }
}
