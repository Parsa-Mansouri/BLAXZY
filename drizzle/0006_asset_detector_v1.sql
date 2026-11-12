-- Asset Detector v1: asset priority and details, and the append-only asset_detection results.
-- Additive only: existing assets read as required with no details.
CREATE TABLE "asset_detection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_version_id" uuid NOT NULL,
	"dami_run_id" uuid,
	"mode" text NOT NULL,
	"scene_index" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diff" jsonb DEFAULT '{"added":[],"updated":[],"removed":[]}'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "priority" text DEFAULT 'required' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "asset_detection" ADD CONSTRAINT "asset_detection_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_detection" ADD CONSTRAINT "asset_detection_script_version_id_script_version_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_detection" ADD CONSTRAINT "asset_detection_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_detection_project_created_idx" ON "asset_detection" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "asset_detection_script_version_idx" ON "asset_detection" USING btree ("script_version_id");