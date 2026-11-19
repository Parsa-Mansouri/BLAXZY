import type { UserFacing } from "@/server/errors";

/** The user's balance does not cover the price. `message` is safe to show. */
export class InsufficientCreditsError extends Error implements UserFacing {
  readonly userFacing = true as const;
  constructor(
    readonly balance: number,
    readonly needed: number,
  ) {
    super(
      `This needs ${needed} credit${needed === 1 ? "" : "s"} and your balance is ${balance}. ` +
        "Add credits, then try again.",
    );
    this.name = "InsufficientCreditsError";
  }
}

/** Invalid billing input or an impossible ledger operation. `message` is safe to show. */
export class BillingInputError extends Error implements UserFacing {
  readonly userFacing = true as const;
  constructor(message: string) {
    super(message);
    this.name = "BillingInputError";
  }
}
