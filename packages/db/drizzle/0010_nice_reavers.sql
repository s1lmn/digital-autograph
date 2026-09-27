CREATE TYPE "public"."autograph_moderation_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."autograph_moderation_reason" AS ENUM('SEXUAL_CONTENT', 'HATE_OR_EXTREMISM', 'THREATS_OR_VIOLENCE', 'PERSONAL_DATA', 'IMPERSONATION_OR_DECEPTIVE', 'ILLEGAL_OR_PROHIBITED', 'NOT_AN_AUTOGRAPH', 'OTHER_POLICY_VIOLATION');--> statement-breakpoint
ALTER TYPE "public"."autograph_status" ADD VALUE 'ready' BEFORE 'processing_failed';--> statement-breakpoint
ALTER TYPE "public"."autograph_status" ADD VALUE 'moderation_rejected' BEFORE 'processing_failed';--> statement-breakpoint
CREATE TABLE "autograph_moderation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autograph_id" uuid NOT NULL,
	"moderator_user_id" uuid NOT NULL,
	"user_approval_id" uuid NOT NULL,
	"cleaned_asset_id" uuid NOT NULL,
	"decision" "autograph_moderation_decision" NOT NULL,
	"reason_code" "autograph_moderation_reason",
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autograph_moderation_decisions_reason_check" CHECK (("autograph_moderation_decisions"."decision" = 'approved' AND "autograph_moderation_decisions"."reason_code" IS NULL) OR ("autograph_moderation_decisions"."decision" = 'rejected' AND "autograph_moderation_decisions"."reason_code" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "autograph_moderation_decisions" ADD CONSTRAINT "autograph_moderation_decisions_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autograph_moderation_decisions" ADD CONSTRAINT "autograph_moderation_decisions_moderator_user_id_users_id_fk" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autograph_moderation_decisions" ADD CONSTRAINT "autograph_moderation_decisions_user_approval_id_autograph_user_approvals_id_fk" FOREIGN KEY ("user_approval_id") REFERENCES "public"."autograph_user_approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autograph_moderation_decisions" ADD CONSTRAINT "autograph_moderation_decisions_cleaned_asset_id_autograph_assets_id_fk" FOREIGN KEY ("cleaned_asset_id") REFERENCES "public"."autograph_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autograph_moderation_decisions_autograph_uidx" ON "autograph_moderation_decisions" USING btree ("autograph_id");--> statement-breakpoint
CREATE INDEX "autograph_moderation_decisions_moderator_idx" ON "autograph_moderation_decisions" USING btree ("moderator_user_id");
--> statement-breakpoint
CREATE FUNCTION reject_autograph_moderation_decision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'autograph moderation decisions are append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER autograph_moderation_decisions_append_only BEFORE UPDATE OR DELETE ON autograph_moderation_decisions
FOR EACH ROW EXECUTE FUNCTION reject_autograph_moderation_decision_mutation();
