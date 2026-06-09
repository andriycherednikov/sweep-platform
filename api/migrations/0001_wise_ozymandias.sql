CREATE TABLE IF NOT EXISTS "fixture" (
	"id" text PRIMARY KEY NOT NULL,
	"group" text NOT NULL,
	"matchday" integer NOT NULL,
	"t1_code" text NOT NULL,
	"t2_code" text NOT NULL,
	"kickoff_utc" timestamp with time zone NOT NULL,
	"venue" text NOT NULL,
	"city" text NOT NULL,
	"status" text NOT NULL,
	"score1" integer,
	"score2" integer,
	"minute" integer,
	"prob_a" integer,
	"prob_d" integer,
	"prob_b" integer,
	"stage" text DEFAULT 'group' NOT NULL,
	"derby" boolean DEFAULT false NOT NULL,
	"double_owner" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"uploader_name" text NOT NULL,
	"person_id" text,
	"team_code" text,
	"file_path" text NOT NULL,
	"thumb_path" text,
	"caption" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moderated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standing" (
	"team_code" text PRIMARY KEY NOT NULL,
	"played" integer DEFAULT 0 NOT NULL,
	"win" integer DEFAULT 0 NOT NULL,
	"draw" integer DEFAULT 0 NOT NULL,
	"loss" integer DEFAULT 0 NOT NULL,
	"gf" integer DEFAULT 0 NOT NULL,
	"ga" integer DEFAULT 0 NOT NULL,
	"pts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support" (
	"fixture_id" text NOT NULL,
	"person_id" text NOT NULL,
	"team_code" text NOT NULL,
	CONSTRAINT "support_fixture_id_person_id_pk" PRIMARY KEY("fixture_id","person_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"counts" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch" (
	"fixture_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "watch_fixture_id_person_id_pk" PRIMARY KEY("fixture_id","person_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixture" ADD CONSTRAINT "fixture_t1_code_team_code_fk" FOREIGN KEY ("t1_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixture" ADD CONSTRAINT "fixture_t2_code_team_code_fk" FOREIGN KEY ("t2_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_team_code_team_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standing" ADD CONSTRAINT "standing_team_code_team_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support" ADD CONSTRAINT "support_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support" ADD CONSTRAINT "support_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support" ADD CONSTRAINT "support_team_code_team_code_fk" FOREIGN KEY ("team_code") REFERENCES "public"."team"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watch" ADD CONSTRAINT "watch_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watch" ADD CONSTRAINT "watch_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
