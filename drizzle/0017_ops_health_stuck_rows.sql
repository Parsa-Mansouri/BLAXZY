CREATE TABLE "ops_alert" (
	"key" text PRIMARY KEY NOT NULL,
	"raised_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"pid" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "worker_heartbeat_seen_idx" ON "worker_heartbeat" USING btree ("seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "asset_look_pending_job_idx" ON "asset_look" USING btree ("id") WHERE "asset_look"."status" = 'pending' and "asset_look"."generation_id" is null;--> statement-breakpoint
CREATE INDEX "asset_sheet_pending_job_idx" ON "asset_sheet" USING btree ("id") WHERE "asset_sheet"."status" = 'pending' and "asset_sheet"."generation_id" is null;--> statement-breakpoint
CREATE INDEX "asset_sheet_view_rewriting_idx" ON "asset_sheet_view" USING btree ("id") WHERE "asset_sheet_view"."status" = 'planned' and "asset_sheet_view"."prompt" is null;--> statement-breakpoint
CREATE INDEX "block_take_pending_job_idx" ON "block_take" USING btree ("id") WHERE "block_take"."status" = 'pending' and "block_take"."generation_id" is null;--> statement-breakpoint
CREATE INDEX "block_take_review_pending_idx" ON "block_take" USING btree ("id") WHERE "block_take"."auto_review" = 'pending';--> statement-breakpoint
CREATE INDEX "creative_bible_pending_idx" ON "creative_bible" USING btree ("id") WHERE "creative_bible"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "export_bundle_pending_idx" ON "export_bundle" USING btree ("id") WHERE "export_bundle"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "project_sectioning_running_idx" ON "project" USING btree ("id") WHERE ("project"."stage_state"->'sectioning'->>'state') = 'running';--> statement-breakpoint
CREATE INDEX "prompt_block_preparing_idx" ON "prompt_block" USING btree ("id") WHERE "prompt_block"."production_state" = 'pending' and "prompt_block"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "script_version_pending_idx" ON "script_version" USING btree ("id") WHERE "script_version"."status" = 'pending';