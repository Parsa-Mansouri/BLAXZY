-- Designers (character, location, prop generators): a look keeps the designer's spec, the user's
-- reference photos with their roles, and answers to the designer's questions. Additive only.
ALTER TABLE "asset_look" ADD COLUMN "spec" jsonb;--> statement-breakpoint
ALTER TABLE "asset_look" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_look" ADD COLUMN "clarify_answers" jsonb;