DO $$ BEGIN
 CREATE TYPE "public"."service_status" AS ENUM('HEALTHY', 'DEGRADED', 'DRIFTING', 'FAILING');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_name" varchar(255) NOT NULL,
	"service_type" varchar(64) NOT NULL,
	"endpoint_url" varchar(512) NOT NULL,
	"mfe_consumer" varchar(255) NOT NULL,
	"status" "service_status" DEFAULT 'HEALTHY' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_registries_service_name_unique" UNIQUE("service_name")
);
