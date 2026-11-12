-- Assets are identified by their real name (unique per project and kind, ignoring case) instead
-- of a slug. Refs change from `kind:slug` to `kind:Name`, in block refs and in prompt tags.
DROP INDEX "asset_project_kind_slug_unique";--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "fix_requests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "new_name" text;--> statement-breakpoint
-- Clean names as `cleanAssetName` does: [ ] become ( ), < > are dropped, a colon becomes " - ",
-- control characters and whitespace runs become one space, trimmed, at most 120 characters.
UPDATE "asset" SET "new_name" = coalesce(
  nullif(
    btrim(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      translate("name", '[]', '()'),
      '[<>]', '', 'g'),
      '\s*:\s*', ' - ', 'g'),
      '[[:cntrl:]]', ' ', 'g'),
      '\s+', ' ', 'g')), 120)),
    ''),
  initcap("kind"));--> statement-breakpoint
-- Duplicates (ignoring case) get Windows-style suffixes: "Mara", "Mara (2)", "Mara (3)". Active
-- assets keep the plain name first, then the oldest.
DO $$
DECLARE
  r record;
  n integer;
  candidate text;
BEGIN
  FOR r IN
    SELECT "id", "project_id", "kind", "new_name"
    FROM (
      SELECT "id", "project_id", "kind", "new_name",
        row_number() OVER (
          PARTITION BY "project_id", "kind", lower("new_name")
          ORDER BY ("status" = 'active') DESC, "created_at", "id"
        ) AS rn
      FROM "asset"
    ) ranked
    WHERE rn > 1
    ORDER BY "project_id", "kind", "new_name", rn
  LOOP
    n := 2;
    LOOP
      candidate := left(r."new_name", 120 - length(' (' || n || ')')) || ' (' || n || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "asset" a
        WHERE a."project_id" = r."project_id" AND a."kind" = r."kind"
          AND lower(a."new_name") = lower(candidate)
      );
      n := n + 1;
    END LOOP;
    UPDATE "asset" SET "new_name" = candidate WHERE "id" = r."id";
  END LOOP;
END $$;--> statement-breakpoint
-- Block refs: each `kind:slug` of a known asset becomes `kind:Name` (order kept).
UPDATE "prompt_block" pb SET "asset_refs" = (
  SELECT coalesce(jsonb_agg(coalesce(a."kind" || ':' || a."new_name", r.ref) ORDER BY r.ord), '[]'::jsonb)
  FROM jsonb_array_elements_text(pb."asset_refs") WITH ORDINALITY AS r(ref, ord)
  LEFT JOIN "asset" a ON a."project_id" = pb."project_id" AND a."kind" || ':' || a."slug" = r.ref
)
WHERE jsonb_array_length(pb."asset_refs") > 0;--> statement-breakpoint
UPDATE "prompt_block" pb SET "production_asset_refs" = (
  SELECT coalesce(jsonb_agg(coalesce(a."kind" || ':' || a."new_name", r.ref) ORDER BY r.ord), '[]'::jsonb)
  FROM jsonb_array_elements_text(pb."production_asset_refs") WITH ORDINALITY AS r(ref, ord)
  LEFT JOIN "asset" a ON a."project_id" = pb."project_id" AND a."kind" || ':' || a."slug" = r.ref
)
WHERE pb."production_asset_refs" IS NOT NULL AND jsonb_array_length(pb."production_asset_refs") > 0;--> statement-breakpoint
-- Prompt tags `[kind:slug]` become `[kind:Name]`. Two passes through a placeholder per asset id,
-- so a new name that equals another asset's old slug is never rewritten twice.
DO $$
DECLARE
  a record;
BEGIN
  FOR a IN SELECT "id", "project_id", "kind", "slug", "new_name" FROM "asset" LOOP
    UPDATE "prompt_block"
    SET "prompt" = replace("prompt", '[' || a."kind" || ':' || a."slug" || ']', '[' || chr(1) || a."id" || chr(1) || ']'),
      "production_prompt" = replace("production_prompt", '[' || a."kind" || ':' || a."slug" || ']', '[' || chr(1) || a."id" || chr(1) || ']')
    WHERE "project_id" = a."project_id"
      AND (strpos("prompt", '[' || a."kind" || ':' || a."slug" || ']') > 0
        OR strpos(coalesce("production_prompt", ''), '[' || a."kind" || ':' || a."slug" || ']') > 0);
  END LOOP;
  FOR a IN SELECT "id", "project_id", "kind", "new_name" FROM "asset" LOOP
    UPDATE "prompt_block"
    SET "prompt" = replace("prompt", '[' || chr(1) || a."id" || chr(1) || ']', '[' || a."kind" || ':' || a."new_name" || ']'),
      "production_prompt" = replace("production_prompt", '[' || chr(1) || a."id" || chr(1) || ']', '[' || a."kind" || ':' || a."new_name" || ']')
    WHERE "project_id" = a."project_id"
      AND (strpos("prompt", chr(1) || a."id" || chr(1)) > 0
        OR strpos(coalesce("production_prompt", ''), chr(1) || a."id" || chr(1)) > 0);
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "asset" SET "name" = "new_name";--> statement-breakpoint
ALTER TABLE "asset" DROP COLUMN "new_name";--> statement-breakpoint
ALTER TABLE "asset" DROP COLUMN "slug";--> statement-breakpoint
CREATE UNIQUE INDEX "asset_project_kind_name_unique" ON "asset" USING btree ("project_id","kind",lower("name"));
