CREATE TABLE "direction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_version_id" uuid NOT NULL,
	"creative_bible_id" uuid,
	"block_mode" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"header" jsonb,
	"plan" jsonb,
	"context" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batch_count" integer DEFAULT 0 NOT NULL,
	"dami_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "direction_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction_id" uuid NOT NULL,
	"batch_index" integer NOT NULL,
	"block_from" integer NOT NULL,
	"block_to" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"blocks" jsonb,
	"dami_run_id" uuid,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prompt_block" ADD COLUMN "direction" jsonb;--> statement-breakpoint
ALTER TABLE "direction" ADD CONSTRAINT "direction_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction" ADD CONSTRAINT "direction_script_version_id_script_version_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction" ADD CONSTRAINT "direction_creative_bible_id_creative_bible_id_fk" FOREIGN KEY ("creative_bible_id") REFERENCES "public"."creative_bible"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction_batch" ADD CONSTRAINT "direction_batch_direction_id_direction_id_fk" FOREIGN KEY ("direction_id") REFERENCES "public"."direction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direction_batch" ADD CONSTRAINT "direction_batch_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direction_project_created_idx" ON "direction" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "direction_script_version_idx" ON "direction" USING btree ("script_version_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "direction_active_unique" ON "direction" USING btree ("script_version_id") WHERE "direction"."status" in ('pending', 'planned', 'writing');--> statement-breakpoint
CREATE UNIQUE INDEX "direction_batch_unique" ON "direction_batch" USING btree ("direction_id","batch_index");