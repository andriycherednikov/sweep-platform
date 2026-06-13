-- Multi-sweep tenancy: sweep table + sweep_id backfill (data-safe).
CREATE TABLE IF NOT EXISTS "sweep" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'token' NOT NULL,
	"member_token" text,
	"admin_token" text,
	"scoring_rule" text DEFAULT 'top3' NOT NULL,
	"co_owners" text DEFAULT 'all_win' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "sweep_member_token_unique" UNIQUE("member_token"),
	CONSTRAINT "sweep_admin_token_unique" UNIQUE("admin_token")
);
--> statement-breakpoint
INSERT INTO "sweep" ("id","name","kind","scoring_rule","co_owners")
VALUES ('default','The Sweep','default','top3','all_win')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "person"    ADD COLUMN IF NOT EXISTS "sweep_id" text;--> statement-breakpoint
ALTER TABLE "ownership" ADD COLUMN IF NOT EXISTS "sweep_id" text;--> statement-breakpoint
ALTER TABLE "watch"     ADD COLUMN IF NOT EXISTS "sweep_id" text;--> statement-breakpoint
ALTER TABLE "support"   ADD COLUMN IF NOT EXISTS "sweep_id" text;--> statement-breakpoint
ALTER TABLE "photo"     ADD COLUMN IF NOT EXISTS "sweep_id" text;--> statement-breakpoint
UPDATE "person"    SET "sweep_id" = 'default' WHERE "sweep_id" IS NULL;--> statement-breakpoint
UPDATE "ownership" SET "sweep_id" = 'default' WHERE "sweep_id" IS NULL;--> statement-breakpoint
UPDATE "watch"     SET "sweep_id" = 'default' WHERE "sweep_id" IS NULL;--> statement-breakpoint
UPDATE "support"   SET "sweep_id" = 'default' WHERE "sweep_id" IS NULL;--> statement-breakpoint
UPDATE "photo"     SET "sweep_id" = 'default' WHERE "sweep_id" IS NULL;--> statement-breakpoint
ALTER TABLE "person"    ALTER COLUMN "sweep_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ownership" ALTER COLUMN "sweep_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "watch"     ALTER COLUMN "sweep_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support"   ALTER COLUMN "sweep_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "photo"     ALTER COLUMN "sweep_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person"    ADD CONSTRAINT "person_sweep_id_sweep_id_fk"    FOREIGN KEY ("sweep_id") REFERENCES "sweep"("id");--> statement-breakpoint
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_sweep_id_sweep_id_fk" FOREIGN KEY ("sweep_id") REFERENCES "sweep"("id");--> statement-breakpoint
ALTER TABLE "watch"     ADD CONSTRAINT "watch_sweep_id_sweep_id_fk"     FOREIGN KEY ("sweep_id") REFERENCES "sweep"("id");--> statement-breakpoint
ALTER TABLE "support"   ADD CONSTRAINT "support_sweep_id_sweep_id_fk"   FOREIGN KEY ("sweep_id") REFERENCES "sweep"("id");--> statement-breakpoint
ALTER TABLE "photo"     ADD CONSTRAINT "photo_sweep_id_sweep_id_fk"     FOREIGN KEY ("sweep_id") REFERENCES "sweep"("id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ownership_sweep_team_uq" ON "ownership" ("sweep_id","team_code");--> statement-breakpoint
DROP TABLE IF EXISTS "scoring_config";
