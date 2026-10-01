DO $$ BEGIN
 CREATE TYPE "public"."governance_status" AS ENUM('AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governance_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drift_event_id" uuid NOT NULL,
	"patch_id" uuid,
	"status" "governance_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reviewer" varchar(255),
	"review_notes" text,
	"reasoning_trace" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_audits" ADD CONSTRAINT "governance_audits_drift_event_id_drift_events_id_fk" FOREIGN KEY ("drift_event_id") REFERENCES "public"."drift_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governance_audits" ADD CONSTRAINT "governance_audits_patch_id_patch_registries_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patch_registries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
