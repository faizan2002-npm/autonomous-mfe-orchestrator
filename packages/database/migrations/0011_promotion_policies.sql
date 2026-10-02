CREATE TABLE IF NOT EXISTS "promotion_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"service_id" uuid,
	"consumer_id" uuid,
	"scope" varchar(80) NOT NULL,
	"name" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_canary_requests" integer DEFAULT 50 NOT NULL,
	"min_canary_minutes" integer DEFAULT 30 NOT NULL,
	"max_failure_rate" double precision DEFAULT 0 NOT NULL,
	"rollback_failure_rate" double precision,
	"rollback_min_requests" integer DEFAULT 10 NOT NULL,
	"allowed_generators" text[] DEFAULT ARRAY['gemini', 'fallback']::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_policies_org_scope_unique" UNIQUE("org_id","scope")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promotion_policies" ADD CONSTRAINT "promotion_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promotion_policies" ADD CONSTRAINT "promotion_policies_service_id_service_registries_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_registries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promotion_policies" ADD CONSTRAINT "promotion_policies_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
