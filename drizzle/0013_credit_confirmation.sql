ALTER TABLE "asset_look" ADD COLUMN "confirmed_credits" integer;--> statement-breakpoint
ALTER TABLE "asset_sheet" ADD COLUMN "confirmed_credits" integer;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD COLUMN "confirmed_credits" integer;--> statement-breakpoint
ALTER TABLE "block_take" ADD COLUMN "confirmed_credits" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "skip_credit_confirm" boolean DEFAULT false NOT NULL;