CREATE TABLE "action_rate_limit" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "action_rate_limit_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX "action_rate_limit_window_idx" ON "action_rate_limit" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "asset_project_order_idx" ON "asset" USING btree ("project_id","display_order","id");--> statement-breakpoint
CREATE INDEX "dami_run_status_started_idx" ON "dami_run" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "file_owner_status_created_idx" ON "file" USING btree ("owner_id","status","created_at");