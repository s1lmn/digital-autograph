CREATE TABLE "checkout_confirmations" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"autograph_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"guaranteed_visibility_seconds" integer NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"target_placement_id" uuid NOT NULL,
	"pricing_config_id" uuid NOT NULL,
	"offer_version" varchar(64) NOT NULL,
	"offer_hash" varchar(64) NOT NULL,
	"content_rules_version" varchar(64) NOT NULL,
	"content_rules_hash" varchar(64) NOT NULL,
	"refund_policy_version" varchar(64) NOT NULL,
	"refund_policy_hash" varchar(64) NOT NULL,
	"source" varchar(64) DEFAULT 'web' NOT NULL,
	"context" varchar(64) DEFAULT 'paid_checkout' NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "checkout_confirmation_semantics" CHECK ("checkout_confirmations"."source"='web' AND "checkout_confirmations"."context"='paid_checkout' AND "checkout_confirmations"."guaranteed_visibility_seconds">=0 AND "checkout_confirmations"."amount_minor" BETWEEN 1 AND 100000000000 AND "checkout_confirmations"."currency"='RUB'),
	CONSTRAINT "checkout_confirmation_identity" CHECK ("checkout_confirmations"."offer_version" ~ '^[a-zA-Z0-9._-]{1,64}$' AND "checkout_confirmations"."content_rules_version" ~ '^[a-zA-Z0-9._-]{1,64}$' AND "checkout_confirmations"."refund_policy_version" ~ '^[a-zA-Z0-9._-]{1,64}$' AND "checkout_confirmations"."offer_hash" ~ '^[a-f0-9]{64}$' AND "checkout_confirmations"."content_rules_hash" ~ '^[a-f0-9]{64}$' AND "checkout_confirmations"."refund_policy_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "checkout_confirmations" ADD CONSTRAINT "checkout_confirmations_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_confirmations" ADD CONSTRAINT "checkout_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_confirmations" ADD CONSTRAINT "checkout_confirmations_reservation_id_takeover_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."takeover_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_confirmations" ADD CONSTRAINT "checkout_confirmations_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_confirmations" ADD CONSTRAINT "checkout_confirmations_target_placement_id_placements_id_fk" FOREIGN KEY ("target_placement_id") REFERENCES "public"."placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_confirmations" ADD CONSTRAINT "checkout_confirmations_pricing_config_id_pricing_config_versions_id_fk" FOREIGN KEY ("pricing_config_id") REFERENCES "public"."pricing_config_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER checkout_confirmation_append_only BEFORE UPDATE OR DELETE ON checkout_confirmations
FOR EACH ROW EXECUTE FUNCTION reject_consent_record_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_checkout_confirmation_insert() RETURNS trigger AS $$
DECLARE o payment_orders%ROWTYPE; r takeover_reservations%ROWTYPE; guarantee integer;
BEGIN
 SELECT * INTO o FROM payment_orders WHERE id=NEW.order_id FOR SHARE;
 SELECT * INTO r FROM takeover_reservations WHERE id=o.reservation_id;
 SELECT guaranteed_visibility_seconds INTO guarantee FROM pricing_config_versions WHERE id=o.pricing_config_id;
 IF o.id IS NULL OR
 (NEW.user_id,NEW.reservation_id,NEW.autograph_id,NEW.amount_minor,NEW.currency,NEW.target_placement_id,NEW.pricing_config_id,NEW.offer_version,NEW.offer_hash,NEW.content_rules_version,NEW.content_rules_hash,NEW.refund_policy_version,NEW.refund_policy_hash)
 IS DISTINCT FROM
 (o.user_id,o.reservation_id,o.autograph_id,o.amount_minor,o.currency,o.target_placement_id,o.pricing_config_id,o.offer_version,o.offer_hash,o.content_rules_version,o.content_rules_hash,o.refund_policy_version,o.refund_policy_hash)
 OR NEW.guaranteed_visibility_seconds IS DISTINCT FROM guarantee OR NEW.reservation_expires_at IS DISTINCT FROM r.expires_at THEN
  RAISE EXCEPTION 'checkout evidence binding mismatch' USING ERRCODE='check_violation';
 END IF;
 IF r.status<>'active' OR r.expires_at<=clock_timestamp() OR o.status<>'created' THEN
  RAISE EXCEPTION 'checkout requires a current admission' USING ERRCODE='check_violation';
 END IF;
 NEW.confirmed_at:=clock_timestamp();
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER checkout_confirmation_insert_guard BEFORE INSERT ON checkout_confirmations
FOR EACH ROW EXECUTE FUNCTION guard_checkout_confirmation_insert();
--> statement-breakpoint
CREATE FUNCTION require_checkout_confirmation() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM checkout_confirmations WHERE order_id=NEW.id) THEN
  RAISE EXCEPTION 'new order requires checkout confirmation' USING ERRCODE='check_violation';
 END IF;
 RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_order_checkout_required AFTER INSERT ON payment_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_checkout_confirmation();
