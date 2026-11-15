CREATE TABLE "creative_bible" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"genre_id" text NOT NULL,
	"style_id" text NOT NULL,
	"style_snapshot" jsonb NOT NULL,
	"bible" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"dami_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "creative_bible_project_version_unique" UNIQUE("project_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "creative_bible" ADD CONSTRAINT "creative_bible_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_bible" ADD CONSTRAINT "creative_bible_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creative_bible_project_created_idx" ON "creative_bible" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "creative_bible_project_status_idx" ON "creative_bible" USING btree ("project_id","status");