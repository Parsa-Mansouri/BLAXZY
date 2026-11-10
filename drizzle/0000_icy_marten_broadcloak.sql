CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"origin" text DEFAULT 'detected' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"first_script_version_id" uuid,
	"last_script_version_id" uuid,
	"dami_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dami_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dami_key" text NOT NULL,
	"dami_version" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"user_id" text,
	"project_id" uuid,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "episode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"target_duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" uuid,
	"storage_key" text NOT NULL,
	"original_name" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"mode" text DEFAULT 'wizard' NOT NULL,
	"stage" text DEFAULT 'style' NOT NULL,
	"stage_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lineage_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"script_version_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"title" text,
	"script_excerpt" text NOT NULL,
	"prompt" text NOT NULL,
	"duration_seconds" integer,
	"asset_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"stale_reason" text,
	"dami_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"issue_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dami_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"version_number" integer NOT NULL,
	"parent_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content" text,
	"brief" text,
	"dami_notes" jsonb,
	"file_id" uuid,
	"dami_run_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "script_version_number_unique" UNIQUE NULLS NOT DISTINCT("project_id","episode_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_first_script_version_id_script_version_id_fk" FOREIGN KEY ("first_script_version_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_last_script_version_id_script_version_id_fk" FOREIGN KEY ("last_script_version_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dami_run" ADD CONSTRAINT "dami_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dami_run" ADD CONSTRAINT "dami_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD CONSTRAINT "prompt_block_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD CONSTRAINT "prompt_block_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD CONSTRAINT "prompt_block_script_version_id_script_version_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_block" ADD CONSTRAINT "prompt_block_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_parent_id_script_version_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_dami_run_id_dami_run_id_fk" FOREIGN KEY ("dami_run_id") REFERENCES "public"."dami_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_project_kind_slug_unique" ON "asset" USING btree ("project_id","kind","slug");--> statement-breakpoint
CREATE INDEX "asset_project_kind_status_idx" ON "asset" USING btree ("project_id","kind","status");--> statement-breakpoint
CREATE INDEX "dami_run_project_created_idx" ON "dami_run" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dami_run_user_created_idx" ON "dami_run" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dami_run_key_version_idx" ON "dami_run" USING btree ("dami_key","dami_version");--> statement-breakpoint
CREATE INDEX "dami_run_status_idx" ON "dami_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_project_number_unique" ON "episode" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "file_project_idx" ON "file" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "file_owner_idx" ON "file" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "project_owner_updated_idx" ON "project" USING btree ("owner_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_event_project_created_idx" ON "project_event" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_block_lineage_version_unique" ON "prompt_block" USING btree ("lineage_id","version_number");--> statement-breakpoint
CREATE INDEX "prompt_block_project_order_idx" ON "prompt_block" USING btree ("project_id","episode_id","order_index");--> statement-breakpoint
CREATE INDEX "prompt_block_script_version_idx" ON "prompt_block" USING btree ("script_version_id");--> statement-breakpoint
CREATE INDEX "review_subject_idx" ON "review" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "review_project_created_idx" ON "review" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "script_version_project_status_idx" ON "script_version" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");