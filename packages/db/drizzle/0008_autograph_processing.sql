CREATE TABLE "autograph_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autograph_id" uuid NOT NULL,
	"original_asset_id" uuid NOT NULL,
	"status" "autograph_processing_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_token" uuid,
	"finished_at" timestamp with time zone,
	"failure_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autograph_processing_jobs_attempts_valid" CHECK ("autograph_processing_jobs"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "autograph_processing_jobs_state_consistency" CHECK (("autograph_processing_jobs"."status" = 'queued' AND "autograph_processing_jobs"."lease_token" IS NULL AND "autograph_processing_jobs"."claimed_at" IS NULL AND "autograph_processing_jobs"."finished_at" IS NULL) OR ("autograph_processing_jobs"."status" = 'processing' AND "autograph_processing_jobs"."lease_token" IS NOT NULL AND "autograph_processing_jobs"."claimed_at" IS NOT NULL AND "autograph_processing_jobs"."finished_at" IS NULL) OR ("autograph_processing_jobs"."status" IN ('succeeded', 'failed') AND "autograph_processing_jobs"."lease_token" IS NULL AND "autograph_processing_jobs"."claimed_at" IS NULL AND "autograph_processing_jobs"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "autograph_assets" DROP CONSTRAINT "autograph_assets_expected_size_valid";--> statement-breakpoint
ALTER TABLE "autograph_assets" DROP CONSTRAINT "autograph_assets_expected_type_valid";--> statement-breakpoint
ALTER TABLE "autograph_assets" DROP CONSTRAINT "autograph_assets_expires_after_create";--> statement-breakpoint
ALTER TABLE "autograph_assets" DROP CONSTRAINT "autograph_assets_state_consistency";--> statement-breakpoint
ALTER TABLE "autograph_assets" ALTER COLUMN "expected_content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "autograph_assets" ALTER COLUMN "expected_size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "autograph_assets" ALTER COLUMN "upload_expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD COLUMN "actual_content_type" varchar(64);--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "autograph_processing_jobs" ADD CONSTRAINT "autograph_processing_jobs_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autograph_processing_jobs" ADD CONSTRAINT "autograph_processing_jobs_original_asset_id_autograph_assets_id_fk" FOREIGN KEY ("original_asset_id") REFERENCES "public"."autograph_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autograph_processing_jobs_one_active_uidx" ON "autograph_processing_jobs" USING btree ("autograph_id") WHERE "autograph_processing_jobs"."status" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "autograph_processing_jobs_claim_idx" ON "autograph_processing_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "autograph_assets_one_cleaned_uidx" ON "autograph_assets" USING btree ("autograph_id") WHERE "autograph_assets"."role" <> 'original';--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD CONSTRAINT "autograph_assets_expected_size_valid" CHECK ("autograph_assets"."expected_size_bytes" IS NULL OR "autograph_assets"."expected_size_bytes" BETWEEN 1 AND 10485760);--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD CONSTRAINT "autograph_assets_expected_type_valid" CHECK ("autograph_assets"."expected_content_type" IS NULL OR "autograph_assets"."expected_content_type" IN ('image/png', 'image/jpeg'));--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD CONSTRAINT "autograph_assets_expires_after_create" CHECK ("autograph_assets"."upload_expires_at" IS NULL OR "autograph_assets"."upload_expires_at" > "autograph_assets"."created_at");--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD CONSTRAINT "autograph_assets_state_consistency" CHECK (("autograph_assets"."role" = 'original' AND "autograph_assets"."expected_content_type" IS NOT NULL AND "autograph_assets"."expected_size_bytes" IS NOT NULL AND "autograph_assets"."upload_expires_at" IS NOT NULL AND "autograph_assets"."actual_content_type" IS NULL AND "autograph_assets"."width" IS NULL AND "autograph_assets"."height" IS NULL AND (("autograph_assets"."status" = 'reserved' AND "autograph_assets"."uploaded_at" IS NULL AND "autograph_assets"."verified_size_bytes" IS NULL) OR ("autograph_assets"."status" = 'uploaded' AND "autograph_assets"."uploaded_at" IS NOT NULL AND "autograph_assets"."verified_size_bytes" IS NOT NULL))) OR ("autograph_assets"."role" <> 'original' AND "autograph_assets"."status" = 'uploaded' AND "autograph_assets"."expected_content_type" IS NULL AND "autograph_assets"."expected_size_bytes" IS NULL AND "autograph_assets"."upload_expires_at" IS NULL AND "autograph_assets"."actual_content_type" = 'image/png' AND "autograph_assets"."verified_size_bytes" BETWEEN 1 AND 10485760 AND "autograph_assets"."width" BETWEEN 1 AND 2048 AND "autograph_assets"."height" BETWEEN 1 AND 2048 AND "autograph_assets"."uploaded_at" IS NOT NULL));
--> statement-breakpoint
CREATE TRIGGER autograph_processing_jobs_updated_at BEFORE UPDATE ON autograph_processing_jobs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
