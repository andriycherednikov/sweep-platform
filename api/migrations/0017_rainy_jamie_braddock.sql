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
ALTER TABLE "bet" ADD COLUMN "parlay_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parlay" ADD CONSTRAINT "parlay_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parlay_sweep_id_idx" ON "parlay" USING btree ("sweep_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet" ADD CONSTRAINT "bet_parlay_id_parlay_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlay"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_parlay_id_idx" ON "bet" USING btree ("parlay_id");