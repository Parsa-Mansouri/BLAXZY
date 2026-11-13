ALTER TABLE "generation" ADD COLUMN "provider_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "block_take_project_lineage_number_idx" ON "block_take" USING btree ("project_id","lineage_id","take_number" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_generation_closed_unique" ON "credit_ledger" USING btree ("generation_id") WHERE "credit_ledger"."type" in ('settle', 'refund');--> statement-breakpoint
CREATE INDEX "file_status_created_idx" ON "file" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "generation_unnotified_idx" ON "generation" USING btree ("finished_at") WHERE "generation"."notified_at" is null and "generation"."finished_at" is not null;--> statement-breakpoint
CREATE INDEX "project_event_project_type_created_idx" ON "project_event" USING btree ("project_id","type","created_at");--> statement-breakpoint
CREATE INDEX "prompt_block_project_current_order_idx" ON "prompt_block" USING btree ("project_id","order_index","id") WHERE "prompt_block"."superseded_at" is null;--> statement-breakpoint
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_nonnegative" CHECK ("credit_balance"."balance" >= 0);--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_price_credits_nonnegative" CHECK ("generation"."price_credits" >= 0);--> statement-breakpoint
-- Generations finished before this migration are treated as notified, so the sweep does not replay their completion hooks.
UPDATE "generation" SET "notified_at" = "finished_at" WHERE "finished_at" IS NOT NULL AND "notified_at" IS NULL AND "status" IN ('succeeded', 'failed', 'cancelled');
