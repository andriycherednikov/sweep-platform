CREATE TABLE IF NOT EXISTS "ownership" (
	"person_id" text NOT NULL,
	"team_code" text NOT NULL,
	CONSTRAINT "ownership_person_id_team_code_pk" PRIMARY KEY("person_id","team_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short" text NOT NULL,
	"initials" text NOT NULL,
	"av_color" text NOT NULL,
	"avatar_path" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scoring_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"rule" text NOT NULL,
	"co_owners" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"pool" text NOT NULL,
	"color" text NOT NULL,
	"strength" integer NOT NULL,
	"flag_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_crosswalk" (
	"team_code" text PRIMARY KEY NOT NULL,
	"provider_team_id" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ownership" ADD CONSTRAINT "ownership_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ownership" ADD CONSTRAINT "ownership_team_code_team_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_crosswalk" ADD CONSTRAINT "team_crosswalk_team_code_team_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
