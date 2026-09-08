ALTER TABLE "bet" DROP CONSTRAINT "bet_person_sweep_fk";
--> statement-breakpoint
ALTER TABLE "coin_ledger" DROP CONSTRAINT "coin_ledger_person_sweep_fk";
--> statement-breakpoint
ALTER TABLE "ownership" DROP CONSTRAINT "ownership_person_sweep_fk";
--> statement-breakpoint
ALTER TABLE "parlay" DROP CONSTRAINT "parlay_person_sweep_fk";
--> statement-breakpoint
ALTER TABLE "photo" DROP CONSTRAINT "photo_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "support" DROP CONSTRAINT "support_person_sweep_fk";
--> statement-breakpoint
ALTER TABLE "login_token" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "login_token" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "ejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bet" ADD CONSTRAINT "bet_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay" ADD CONSTRAINT "parlay_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support" ADD CONSTRAINT "support_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_token_email_idx" ON "login_token" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "person_sweep_account_uq" ON "person" USING btree ("sweep_id","account_id");