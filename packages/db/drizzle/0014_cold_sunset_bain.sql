CREATE TYPE "public"."payment_state" AS ENUM('created', 'provider_pending', 'unknown', 'succeeded', 'canceled', 'paid_but_not_fulfilled', 'fulfilled');--> statement-breakpoint
ALTER TYPE "public"."takeover_reservation_status" ADD VALUE 'consumed';--> statement-breakpoint
CREATE TABLE "creator_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"gross_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"share_bps" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_earnings_amount" CHECK ("creator_earnings"."currency" = 'RUB' AND "creator_earnings"."share_bps" BETWEEN 0 AND 10000 AND "creator_earnings"."gross_amount_minor" BETWEEN 1 AND 100000000000 AND "creator_earnings"."amount_minor" = ("creator_earnings"."gross_amount_minor" * "creator_earnings"."share_bps") / 10000)
);
--> statement-breakpoint
CREATE TABLE "payment_event_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"result" text
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"wall_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"target_placement_id" uuid NOT NULL,
	"autograph_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"pricing_config_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"creator_share_bps" integer NOT NULL,
	"status" "payment_state" DEFAULT 'created' NOT NULL,
	"placement_id" uuid,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_amount" CHECK ("payment_orders"."amount_minor" BETWEEN 1 AND 100000000000 AND "payment_orders"."currency" = 'RUB' AND "payment_orders"."creator_share_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "payment_orders_fulfillment" CHECK (("payment_orders"."status" = 'fulfilled' AND "payment_orders"."placement_id" IS NOT NULL AND "payment_orders"."fulfilled_at" IS NOT NULL) OR ("payment_orders"."status" <> 'fulfilled' AND "payment_orders"."placement_id" IS NULL AND "payment_orders"."fulfilled_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"shop_id" text NOT NULL,
	"mode" text NOT NULL,
	"provider_payment_id" text,
	"operation_key" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"return_url" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "payment_state" DEFAULT 'created' NOT NULL,
	"raw_status" varchar(256),
	"confirmation_url" text,
	"reason" text,
	"verified_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_config" CHECK ("payments"."provider" = 'yookassa' AND "payments"."mode" IN ('sandbox','live')),
	CONSTRAINT "payments_amount" CHECK ("payments"."amount_minor" BETWEEN 1 AND 100000000000 AND "payments"."currency" = 'RUB'),
	CONSTRAINT "payments_fingerprint" CHECK ("payments"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payments_verified" CHECK ("payments"."status" NOT IN ('succeeded','fulfilled','paid_but_not_fulfilled') OR ("payments"."verified_at" IS NOT NULL AND "payments"."provider_payment_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "takeover_reservations" DROP CONSTRAINT "takeover_reservations_state_valid";--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_reservation_id_takeover_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."takeover_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_quote_id_takeover_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."takeover_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_target_placement_id_placements_id_fk" FOREIGN KEY ("target_placement_id") REFERENCES "public"."placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_pricing_config_id_pricing_config_versions_id_fk" FOREIGN KEY ("pricing_config_id") REFERENCES "public"."pricing_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_earnings_order_uidx" ON "creator_earnings" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_earnings_payment_uidx" ON "creator_earnings" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_earnings_placement_uidx" ON "creator_earnings" USING btree ("placement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_receipts_identity" ON "payment_event_receipts" USING btree ("provider","provider_payment_id","event");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_reservation_uidx" ON "payment_orders" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_placement_uidx" ON "payment_orders" USING btree ("placement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uidx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_uidx" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_operation_uidx" ON "payments" USING btree ("operation_key");--> statement-breakpoint
CREATE INDEX "payments_reconcile_idx" ON "payments" USING btree ("next_check_at");--> statement-breakpoint
ALTER TABLE "takeover_reservations" ADD CONSTRAINT "takeover_reservations_state_valid" CHECK (("takeover_reservations"."status"::text = 'consumed' AND "takeover_reservations"."consumed_at" IS NOT NULL AND "takeover_reservations"."cancelled_at" IS NULL AND "takeover_reservations"."expired_at" IS NULL) OR ("takeover_reservations"."status" = 'active' AND "takeover_reservations"."consumed_at" IS NULL AND "takeover_reservations"."cancelled_at" IS NULL AND "takeover_reservations"."expired_at" IS NULL) OR ("takeover_reservations"."status" = 'cancelled' AND "takeover_reservations"."cancelled_at" IS NOT NULL AND "takeover_reservations"."expired_at" IS NULL AND "takeover_reservations"."cancelled_at" >= "takeover_reservations"."created_at") OR ("takeover_reservations"."status" = 'expired' AND "takeover_reservations"."expired_at" IS NOT NULL AND "takeover_reservations"."cancelled_at" IS NULL AND "takeover_reservations"."expired_at" >= "takeover_reservations"."created_at"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_takeover_reservation_mutation() RETURNS trigger AS $$
DECLARE quoted takeover_quotes%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reservation history cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO quoted FROM takeover_quotes WHERE id = NEW.quote_id;
    IF NOT FOUND OR NEW.status <> 'active'
       OR (NEW.user_id, NEW.wall_id, NEW.slot_id, NEW.target_placement_id,
           NEW.pricing_config_id, NEW.currency, NEW.amount_minor)
          IS DISTINCT FROM
          (quoted.user_id, quoted.wall_id, quoted.slot_id,
           quoted.target_placement_id, quoted.pricing_config_id,
           quoted.currency, quoted.amount_minor) THEN
      RAISE EXCEPTION 'reservation snapshot must match quote' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.quote_id, NEW.user_id, NEW.wall_id, NEW.slot_id,
      NEW.target_placement_id, NEW.pricing_config_id, NEW.currency,
      NEW.amount_minor, NEW.idempotency_key_hash, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.quote_id, OLD.user_id, OLD.wall_id, OLD.slot_id,
      OLD.target_placement_id, OLD.pricing_config_id, OLD.currency,
      OLD.amount_minor, OLD.idempotency_key_hash, OLD.created_at, OLD.expires_at)
     OR OLD.status <> 'active'
     OR NEW.status NOT IN ('expired', 'cancelled', 'consumed') THEN
    RAISE EXCEPTION 'reservation snapshot or lifecycle is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION guard_payment_order() RETURNS trigger AS $$
DECLARE r takeover_reservations%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment history is immutable' USING ERRCODE='check_violation'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO r FROM takeover_reservations WHERE id=NEW.reservation_id;
  IF NOT FOUND OR r.status<>'active' OR
   (NEW.user_id,NEW.quote_id,NEW.wall_id,NEW.slot_id,NEW.target_placement_id,NEW.pricing_config_id,NEW.amount_minor,NEW.currency)
   IS DISTINCT FROM (r.user_id,r.quote_id,r.wall_id,r.slot_id,r.target_placement_id,r.pricing_config_id,r.amount_minor,r.currency)
   OR NEW.status<>'created' THEN RAISE EXCEPTION 'invalid order snapshot' USING ERRCODE='check_violation'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','placement_id','fulfilled_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','placement_id','fulfilled_at'])
   OR (OLD.status IN ('fulfilled','paid_but_not_fulfilled') AND NEW IS DISTINCT FROM OLD)
   THEN RAISE EXCEPTION 'immutable order snapshot/fulfillment' USING ERRCODE='check_violation'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_orders FOR EACH ROW EXECUTE FUNCTION guard_payment_order();
--> statement-breakpoint
CREATE FUNCTION guard_payment_attempt() RETURNS trigger AS $$
DECLARE o payment_orders%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment history is immutable' USING ERRCODE='check_violation'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO o FROM payment_orders WHERE id=NEW.order_id;
  IF NOT FOUND OR (NEW.amount_minor,NEW.currency) IS DISTINCT FROM (o.amount_minor,o.currency) OR NEW.status<>'created'
   THEN RAISE EXCEPTION 'invalid payment snapshot' USING ERRCODE='check_violation'; END IF;
 ELSE
  IF (NEW.id,NEW.order_id,NEW.provider,NEW.shop_id,NEW.mode,NEW.operation_key,NEW.request_fingerprint,NEW.return_url,NEW.amount_minor,NEW.currency,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.provider,OLD.shop_id,OLD.mode,OLD.operation_key,OLD.request_fingerprint,OLD.return_url,OLD.amount_minor,OLD.currency,OLD.created_at)
   OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
   OR (OLD.status IN ('fulfilled','paid_but_not_fulfilled') AND NEW.status<>OLD.status)
   OR (OLD.status='canceled' AND NEW.status NOT IN ('canceled','paid_but_not_fulfilled'))
   THEN RAISE EXCEPTION 'immutable payment binding/state' USING ERRCODE='check_violation'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_attempt();
--> statement-breakpoint
CREATE FUNCTION guard_creator_earning() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'creator earnings are append-only' USING ERRCODE='check_violation';
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER creator_earnings_immutable BEFORE UPDATE OR DELETE ON creator_earnings FOR EACH ROW EXECUTE FUNCTION guard_creator_earning();
--> statement-breakpoint
CREATE FUNCTION verify_payment_aggregate() RETURNS trigger AS $$
DECLARE oid uuid; o payment_orders%ROWTYPE; p payments%ROWTYPE; e creator_earnings%ROWTYPE; placed placements%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='payment_orders' THEN oid=NEW.id; ELSE oid=NEW.order_id; END IF;
 SELECT * INTO o FROM payment_orders WHERE id=oid;
 SELECT * INTO p FROM payments WHERE order_id=oid;
 IF NOT FOUND OR o.status<>p.status THEN RAISE EXCEPTION 'order/payment state mismatch' USING ERRCODE='check_violation'; END IF;
 SELECT * INTO e FROM creator_earnings WHERE order_id=oid;
 IF o.status='fulfilled' THEN
  SELECT * INTO placed FROM placements WHERE id=o.placement_id;
  IF e.id IS NULL OR (e.payment_id,e.placement_id,e.creator_id,e.gross_amount_minor,e.share_bps,e.currency)
    IS DISTINCT FROM (p.id,o.placement_id,o.creator_id,o.amount_minor,o.creator_share_bps,o.currency)
    OR (placed.slot_id,placed.user_id,placed.autograph_id,placed.source::text)
      IS DISTINCT FROM (o.slot_id,o.user_id,o.autograph_id,'takeover')
    OR p.raw_status IS DISTINCT FROM 'succeeded' OR p.verified_at IS NULL
    OR NOT EXISTS (SELECT 1 FROM takeover_reservations WHERE id=o.reservation_id AND status='consumed')
   THEN RAISE EXCEPTION 'incomplete fulfillment evidence' USING ERRCODE='check_violation'; END IF;
 ELSIF e.id IS NOT NULL THEN RAISE EXCEPTION 'earning without fulfillment' USING ERRCODE='check_violation'; END IF;
 RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_orders_complete AFTER INSERT OR UPDATE ON payment_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payment_aggregate();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_complete AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payment_aggregate();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER creator_earnings_complete AFTER INSERT ON creator_earnings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payment_aggregate();
