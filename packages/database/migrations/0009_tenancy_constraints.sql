ALTER TABLE "service_registries" DROP CONSTRAINT "service_registries_service_name_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "contract_service_endpoint_method_ver_idx";--> statement-breakpoint
ALTER TABLE "service_registries" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_contracts" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_contracts" ALTER COLUMN "consumer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "drift_events" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "drift_events" ALTER COLUMN "consumer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "patch_registries" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "patch_registries" ALTER COLUMN "consumer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "governance_audits" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_registries_org_name_idx" ON "service_registries" ("org_id","service_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_consumer_endpoint_method_ver_idx" ON "api_contracts" ("service_id","consumer_id","endpoint_path","http_method","version");--> statement-breakpoint
ALTER TABLE "service_registries" DROP COLUMN IF EXISTS "service_type";--> statement-breakpoint
ALTER TABLE "service_registries" DROP COLUMN IF EXISTS "mfe_consumer";