CREATE TABLE "block_take" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"take_number" integer NOT NULL,
	"stage" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"parent_id" uuid,
	"draft_take_id" uuid,
	"prompt" text,
	"reference_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_id" uuid,
	"file_id" uuid,
	"poster_file_id" uuid,
	"dami_run_id" uuid,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "export_bundle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_id" uuid,
	"clip_count" integer DEFAULT 0 NOT NULL,
	"content_key" text NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "production_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "production_prompt" text;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "production_asset_refs" jsonb;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "production_notes" jsonb;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "production_dami_run_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "production_failure" text;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_block_id_prompt_block_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."prompt_block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_parent_id_block_take_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."block_take"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_draft_take_id_block_take_id_fk" FOREIGN KEY ("draft_take_id") REFERENCES "public"."block_take"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_poster_file_id_file_id_fk" FOREIGN KEY ("poster_file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_take" ADD CONSTRAINT "block_take_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_bundle" ADD CONSTRAINT "export_bundle_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_bundle" ADD CONSTRAINT "export_bundle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_bundle" ADD CONSTRAINT "export_bundle_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "block_take_lineage_number_unique" ON "block_take" USING btree ("lineage_id","take_number");--> statement-breakpoint
CREATE INDEX "block_take_project_status_idx" ON "block_take" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "block_take_block_idx" ON "block_take" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "export_bundle_project_created_idx" ON "export_bundle" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "prompt_block" ADD CONSTRAINT "prompt_block_production_dami_run_id_dami_run_id_fk" FOREIGN KEY ("production_dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;