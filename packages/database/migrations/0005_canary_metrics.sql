CREATE TABLE IF NOT EXISTS "canary_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patch_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"baseline_requests" integer NOT NULL,
	"baseline_errors" integer NOT NULL,
	"canary_requests" integer NOT NULL,
	"canary_errors" integer NOT NULL,
	"avg_latency_ms" double precision NOT NULL,
	"promoted" boolean DEFAULT false NOT NULL,
	"evaluation_notes" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canary_metrics" ADD CONSTRAINT "canary_metrics_patch_id_patch_registries_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patch_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
