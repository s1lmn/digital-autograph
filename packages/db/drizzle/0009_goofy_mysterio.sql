ALTER TYPE "public"."autograph_status" ADD VALUE 'awaiting_moderation' BEFORE 'processing_failed';--> statement-breakpoint
CREATE TABLE "autograph_user_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autograph_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cleaned_asset_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autograph_user_approvals" ADD CONSTRAINT "autograph_user_approvals_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autograph_user_approvals" ADD CONSTRAINT "autograph_user_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autograph_user_approvals" ADD CONSTRAINT "autograph_user_approvals_cleaned_asset_id_autograph_assets_id_fk" FOREIGN KEY ("cleaned_asset_id") REFERENCES "public"."autograph_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autograph_user_approvals_autograph_uidx" ON "autograph_user_approvals" USING btree ("autograph_id");--> statement-breakpoint
CREATE INDEX "autograph_user_approvals_user_idx" ON "autograph_user_approvals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "autograph_user_approvals_cleaned_asset_idx" ON "autograph_user_approvals" USING btree ("cleaned_asset_id");
--> statement-breakpoint
CREATE FUNCTION reject_autograph_user_approval_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'autograph user approvals are append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER autograph_user_approvals_append_only BEFORE UPDATE OR DELETE ON autograph_user_approvals
FOR EACH ROW EXECUTE FUNCTION reject_autograph_user_approval_mutation();
--> statement-breakpoint
CREATE FUNCTION reject_approved_cleaned_asset_mutation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM autograph_user_approvals WHERE cleaned_asset_id = OLD.id) THEN
    RAISE EXCEPTION 'approved cleaned assets are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approved_cleaned_assets_immutable BEFORE UPDATE OR DELETE ON autograph_assets
FOR EACH ROW EXECUTE FUNCTION reject_approved_cleaned_asset_mutation();
