/** Input the user can fix, or a step that is not possible now. `message` is safe to show. */
export class ProductionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionInputError";
  }
}

export const PRICE_CHANGED_MESSAGE = "The price changed. Check the new total, then confirm again.";

/**
 * `startDrafts` was confirmed with a total that is not the current one any more: the screen should
 * show the new quote. A `ProductionInputError` (same message as before), so existing handling
 * keeps working; check `instanceof PriceChangedError` (or `code`) instead of the message text.
 */
export class PriceChangedError extends ProductionInputError {
  readonly code = "price_changed" as const;
  constructor() {
    super(PRICE_CHANGED_MESSAGE);
    this.name = "PriceChangedError";
  }
}
