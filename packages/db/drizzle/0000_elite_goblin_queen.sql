CREATE TYPE "public"."placement_source" AS ENUM('free_claim', 'takeover', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled', 'anonymized');--> statement-breakpoint
CREATE TYPE "public"."wall_status" AS ENUM('draft', 'scheduled', 'live', 'paused', 'ended', 'archived');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_type" varchar(64) NOT NULL,
	"document_version" varchar(64) NOT NULL,
	"source" varchar(64),
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_type_nonblank" CHECK (length(btrim("consent_records"."document_type")) > 0),
	CONSTRAINT "consent_records_version_nonblank" CHECK (length(btrim("consent_records"."document_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(128) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_slug_format" CHECK ("creator_profiles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "creator_profiles_name_nonblank" CHECK (length(btrim("creator_profiles"."display_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "placement_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "placements_end_consistency" CHECK (("placements"."ended_at" IS NULL AND "placements"."end_reason" IS NULL) OR ("placements"."ended_at" IS NOT NULL AND "placements"."end_reason" IS NOT NULL AND length(btrim("placements"."end_reason")) > 0 AND "placements"."ended_at" >= "placements"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_secret_hash_nonblank" CHECK (length(btrim("sessions"."secret_hash")) > 0),
	CONSTRAINT "sessions_expires_after_create" CHECK ("sessions"."expires_at" > "sessions"."created_at"),
	CONSTRAINT "sessions_revoked_after_create" CHECK ("sessions"."revoked_at" IS NULL OR "sessions"."revoked_at" >= "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wall_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_position_nonnegative" CHECK ("slots"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "social_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_identities_provider_nonblank" CHECK (length(btrim("social_identities"."provider")) > 0),
	CONSTRAINT "social_identities_provider_user_id_nonblank" CHECK (length(btrim("social_identities"."provider_user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "walls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" "wall_status" DEFAULT 'draft' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"slot_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walls_slot_count_nonnegative" CHECK ("walls"."slot_count" >= 0),
	CONSTRAINT "walls_end_after_start" CHECK ("walls"."start_at" IS NULL OR "walls"."end_at" IS NULL OR "walls"."end_at" > "walls"."start_at")
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_identities" ADD CONSTRAINT "social_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walls" ADD CONSTRAINT "walls_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_user_type_time_idx" ON "consent_records" USING btree ("user_id","document_type","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_slug_uidx" ON "creator_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "creators_owner_user_idx" ON "creators" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_one_active_per_slot_uidx" ON "placements" USING btree ("slot_id") WHERE "placements"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "placements_slot_history_idx" ON "placements" USING btree ("slot_id","started_at");--> statement-breakpoint
CREATE INDEX "placements_user_started_idx" ON "placements" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_secret_hash_uidx" ON "sessions" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slots_wall_position_uidx" ON "slots" USING btree ("wall_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "social_identities_provider_user_uidx" ON "social_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "social_identities_user_idx" ON "social_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "walls_creator_created_idx" ON "walls" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "walls_status_start_idx" ON "walls" USING btree ("status","start_at");