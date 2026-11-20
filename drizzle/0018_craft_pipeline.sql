DROP INDEX "direction_active_unique";--> statement-breakpoint
DROP INDEX "direction_batch_unique";--> statement-breakpoint
ALTER TABLE "direction" ADD COLUMN "craft" jsonb;--> statement-breakpoint
ALTER TABLE "direction" ADD COLUMN "shot_plan" jsonb;--> statement-breakpoint
ALTER TABLE "direction" ADD COLUMN "visual" jsonb;--> statement-breakpoint
ALTER TABLE "direction" ADD COLUMN "breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "direction_batch" ADD COLUMN "kind" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "direction_batch" ADD COLUMN "scene_visuals" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "direction_active_unique" ON "direction" USING btree ("script_version_id") WHERE "direction"."status" in ('pending', 'directing', 'lighting', 'planned', 'writing');--> statement-breakpoint
CREATE UNIQUE INDEX "direction_batch_unique" ON "direction_batch" USING btree ("direction_id","kind","batch_index");