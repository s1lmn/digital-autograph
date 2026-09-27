CREATE TYPE "public"."autograph_asset_role" AS ENUM('original');--> statement-breakpoint
CREATE TYPE "public"."autograph_asset_status" AS ENUM('reserved', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."autograph_source" AS ENUM('photo', 'canvas');--> statement-breakpoint
CREATE TYPE "public"."autograph_status" AS ENUM('draft', 'upload_pending', 'uploaded_unverified');--> statement-breakpoint
CREATE TABLE "autograph_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autograph_id" uuid NOT NULL,
	"role" "autograph_asset_role" NOT NULL,
	"status" "autograph_asset_status" DEFAULT 'reserved' NOT NULL,
	"storage_key" text NOT NULL,
	"expected_content_type" varchar(64) NOT NULL,
	"expected_size_bytes" integer NOT NULL,
	"verified_size_bytes" integer,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autograph_assets_storage_key_nonblank" CHECK (length(btrim("autograph_assets"."storage_key")) > 0),
	CONSTRAINT "autograph_assets_expected_size_valid" CHECK ("autograph_assets"."expected_size_bytes" BETWEEN 1 AND 10485760),
	CONSTRAINT "autograph_assets_verified_size_valid" CHECK ("autograph_assets"."verified_size_bytes" IS NULL OR "autograph_assets"."verified_size_bytes" BETWEEN 1 AND 10485760),
	CONSTRAINT "autograph_assets_expected_type_valid" CHECK ("autograph_assets"."expected_content_type" IN ('image/png', 'image/jpeg')),
	CONSTRAINT "autograph_assets_expires_after_create" CHECK ("autograph_assets"."upload_expires_at" > "autograph_assets"."created_at"),
	CONSTRAINT "autograph_assets_state_consistency" CHECK (("autograph_assets"."status" = 'reserved' AND "autograph_assets"."uploaded_at" IS NULL AND "autograph_assets"."verified_size_bytes" IS NULL) OR ("autograph_assets"."status" = 'uploaded' AND "autograph_assets"."uploaded_at" IS NOT NULL AND "autograph_assets"."verified_size_bytes" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "autographs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "autograph_source" NOT NULL,
	"status" "autograph_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "autograph_id" uuid;--> statement-breakpoint
ALTER TABLE "autograph_assets" ADD CONSTRAINT "autograph_assets_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autographs" ADD CONSTRAINT "autographs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autograph_assets_one_original_uidx" ON "autograph_assets" USING btree ("autograph_id") WHERE "autograph_assets"."role" = 'original';--> statement-breakpoint
CREATE UNIQUE INDEX "autograph_assets_storage_key_uidx" ON "autograph_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "autographs_user_created_idx" ON "autographs" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "placements_autograph_idx" ON "placements" USING btree ("autograph_id");--> statement-breakpoint
CREATE TRIGGER autographs_updated_at BEFORE UPDATE ON autographs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER autograph_assets_updated_at BEFORE UPDATE ON autograph_assets
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
