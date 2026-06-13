ALTER TABLE "ownership" DROP CONSTRAINT "ownership_sweep_id_sweep_id_fk";
--> statement-breakpoint
ALTER TABLE "ownership" DROP CONSTRAINT "ownership_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "support" DROP CONSTRAINT "support_sweep_id_sweep_id_fk";
--> statement-breakpoint
ALTER TABLE "support" DROP CONSTRAINT "support_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "watch" DROP CONSTRAINT "watch_sweep_id_sweep_id_fk";
--> statement-breakpoint
ALTER TABLE "watch" DROP CONSTRAINT "watch_person_id_person_id_fk";
--> statement-breakpoint
-- Parent unique MUST exist before the composite FKs below can reference (id, sweep_id).
ALTER TABLE "person" ADD CONSTRAINT "person_id_sweep_id_uq" UNIQUE("id","sweep_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ownership" ADD CONSTRAINT "ownership_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
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
 ALTER TABLE "watch" ADD CONSTRAINT "watch_person_sweep_fk" FOREIGN KEY ("person_id","sweep_id") REFERENCES "public"."person"("id","sweep_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ownership_sweep_id_idx" ON "ownership" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_sweep_id_idx" ON "person" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_sweep_id_idx" ON "photo" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sweep_id_idx" ON "support" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_sweep_id_idx" ON "watch" USING btree ("sweep_id");
