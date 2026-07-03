CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bet" (
	"id" text PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"person_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"selection" text NOT NULL,
	"market" text DEFAULT '1x2' NOT NULL,
	"line" numeric,
	"stake" integer NOT NULL,
	"odds_decimal" numeric NOT NULL,
	"book" text,
	"potential_payout" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"parlay_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coin_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"person_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_ledger_entry_uq" UNIQUE("sweep_id","person_id","type","ref_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competition" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"sport" text NOT NULL,
	"league_id" text NOT NULL,
	"season" text NOT NULL,
	"format" text NOT NULL,
	"name" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_provider_uq" UNIQUE("provider","sport","league_id","season")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competitor" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"logo" text,
	"provider_id" integer,
	"meta" jsonb,
	CONSTRAINT "competitor_competition_code_uq" UNIQUE("competition_id","code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"c1_code" text NOT NULL,
	"c2_code" text NOT NULL,
	"start_utc" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"score1" integer,
	"score2" integer,
	"winner_code" text,
	"round" text,
	"stage" text DEFAULT 'group' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ownership" (
	"sweep_id" text NOT NULL,
	"person_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	CONSTRAINT "ownership_person_id_competitor_id_pk" PRIMARY KEY("person_id","competitor_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parlay" (
	"id" text PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"person_id" text NOT NULL,
	"stake" integer NOT NULL,
	"combined_odds" numeric NOT NULL,
	"potential_payout" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person" (
	"id" text PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"name" text NOT NULL,
	"short" text NOT NULL,
	"initials" text NOT NULL,
	"av_color" text NOT NULL,
	"avatar_path" text,
	"adult" boolean DEFAULT true NOT NULL,
	"excluded_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_id_sweep_id_uq" UNIQUE("id","sweep_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo" (
	"id" text PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"kind" text NOT NULL,
	"uploader_name" text NOT NULL,
	"person_id" text,
	"fixture_id" text,
	"file_path" text NOT NULL,
	"thumb_path" text,
	"caption" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moderated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ranking" (
	"competition_id" text NOT NULL,
	"competitor_code" text NOT NULL,
	"rank" integer,
	"points" integer DEFAULT 0 NOT NULL,
	"stats" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ranking_competition_id_competitor_code_pk" PRIMARY KEY("competition_id","competitor_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support" (
	"sweep_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"person_id" text NOT NULL,
	"team_code" text NOT NULL,
	CONSTRAINT "support_fixture_id_person_id_pk" PRIMARY KEY("fixture_id","person_id")
);
--> statement-breakpoint
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
	"competition_id" text NOT NULL,
	"account_id" text,
	CONSTRAINT "sweep_member_token_unique" UNIQUE("member_token"),
	CONSTRAINT "sweep_admin_token_unique" UNIQUE("admin_token")
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
DO $$ BEGIN
 ALTER TABLE "bet" ADD CONSTRAINT "bet_fixture_id_event_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet" ADD CONSTRAINT "bet_parlay_id_parlay_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlay"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet" ADD CONSTRAINT "bet_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "competitor" ADD CONSTRAINT "competitor_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_c1_fk" FOREIGN KEY ("c1_code","competition_id") REFERENCES "public"."competitor"("code","competition_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_c2_fk" FOREIGN KEY ("c2_code","competition_id") REFERENCES "public"."competitor"("code","competition_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ownership" ADD CONSTRAINT "ownership_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ownership" ADD CONSTRAINT "ownership_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parlay" ADD CONSTRAINT "parlay_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person" ADD CONSTRAINT "person_sweep_id_sweep_id_fk" FOREIGN KEY ("sweep_id") REFERENCES "public"."sweep"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_sweep_id_sweep_id_fk" FOREIGN KEY ("sweep_id") REFERENCES "public"."sweep"("id") ON DELETE no action ON UPDATE no action;
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
 ALTER TABLE "photo" ADD CONSTRAINT "photo_fixture_id_event_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ranking" ADD CONSTRAINT "ranking_competitor_fk" FOREIGN KEY ("competitor_code","competition_id") REFERENCES "public"."competitor"("code","competition_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support" ADD CONSTRAINT "support_fixture_id_event_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support" ADD CONSTRAINT "support_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sweep" ADD CONSTRAINT "sweep_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sweep" ADD CONSTRAINT "sweep_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_sweep_id_idx" ON "bet" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_fixture_id_idx" ON "bet" USING btree ("fixture_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_parlay_id_idx" ON "bet" USING btree ("parlay_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coin_ledger_sweep_id_idx" ON "coin_ledger" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_competition_id_idx" ON "competitor" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_competition_start_idx" ON "event" USING btree ("competition_id","start_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ownership_sweep_id_idx" ON "ownership" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parlay_sweep_id_idx" ON "parlay" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_sweep_id_idx" ON "person" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_sweep_id_idx" ON "photo" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sweep_id_idx" ON "support" USING btree ("sweep_id");