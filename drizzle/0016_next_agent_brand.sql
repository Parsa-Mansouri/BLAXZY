ALTER TABLE "block_take" ADD COLUMN "auto_review" text DEFAULT 'skipped' NOT NULL;--> statement-breakpoint
ALTER TABLE "block_take" ADD COLUMN "review_report" jsonb;--> statement-breakpoint
ALTER TABLE "block_take" ADD COLUMN "route" text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE "block_take" ADD COLUMN "last_frame_file_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "handoff_notice" jsonb;--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "confirmed_credits" integer;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_last_frame_file_id_file_id_fk" FOREIGN KEY ("last_frame_file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;