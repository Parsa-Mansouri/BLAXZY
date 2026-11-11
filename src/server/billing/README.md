# billing

Credits (`@/server/billing`, contract in `docs/M2_M3_CONTRACTS.md`). Owns `credit_ledger` and
`credit_balance`.

- The ledger is append-only. `amount` is signed: `grant` and `refund` positive, `reserve`
  negative, `settle` zero (marks a reservation spent). The balance is always the sum.
- Every operation writes its entry and updates `credit_balance` in one transaction holding the
  user's balance row lock (`FOR UPDATE`), so concurrent reservations cannot overspend and the
  balance never goes negative.
- `reserve` throws `InsufficientCreditsError` (`balance`, `needed`, user-safe message); repeating
  it for the same generation and amount is a no-op. `settle` and `refund` are idempotent and
  exclude each other (a second, different close throws `BillingInputError`; the unique index on
  generation + type is the backstop).
- `reserve`, `settle` and `refund` take an optional `tx` to run inside the caller's transaction.
- Amounts are whole numbers: grants 1 to 1,000,000, prices 0 to 1,000,000, balances at most
  1,000,000,000. `listLedger` is keyset-paginated, newest first.

Development: `pnpm dev:credits <email> <amount> [note]` (refuses in production).
