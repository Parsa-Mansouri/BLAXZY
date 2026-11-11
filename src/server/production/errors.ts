/** Input the user can fix, or a step that is not possible now. `message` is safe to show. */
export class ProductionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionInputError";
  }
}
