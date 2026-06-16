CREATE TABLE IF NOT EXISTS "bet" (
	"id" text PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"person_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"selection" text NOT NULL,
	"stake" integer NOT NULL,
	"odds_decimal" numeric NOT NULL,
	"book" text,
	"potential_payout" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
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
DO $$ BEGIN
 ALTER TABLE "bet" ADD CONSTRAINT "bet_fixture_id_fixture_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixture"("id") ON DELETE no action ON UPDATE no action;
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
CREATE INDEX IF NOT EXISTS "bet_sweep_id_idx" ON "bet" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_fixture_id_idx" ON "bet" USING btree ("fixture_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coin_ledger_sweep_id_idx" ON "coin_ledger" USING btree ("sweep_id");