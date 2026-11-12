CREATE TABLE "asset_sheet_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"view_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"parent_id" uuid,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"purpose" text,
	"prompt" text,
	"aspect_ratio" text DEFAULT '16:9' NOT NULL,
	"reference_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"must_show" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"must_not_show" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_focus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_hypotheses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edit_mode" text DEFAULT 'full' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_id" uuid,
	"file_id" uuid,
	"dami_run_id" uuid,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "asset_sheet" ADD COLUMN "spec" jsonb;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_sheet_id_asset_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."asset_sheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_parent_id_asset_sheet_view_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset_sheet_view"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sheet_view" ADD CONSTRAINT "asset_sheet_view_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_sheet_view_version_unique" ON "asset_sheet_view" USING btree ("sheet_id","view_id","version_number");--> statement-breakpoint
CREATE INDEX "asset_sheet_view_sheet_idx" ON "asset_sheet_view" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "asset_sheet_view_project_status_idx" ON "asset_sheet_view" USING btree ("project_id","status");