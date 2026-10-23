CREATE TABLE "legal_evidence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "legal_evidence_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"document_type" varchar(64) NOT NULL,
	"document_version" varchar(64) NOT NULL,
	"document_hash" varchar(64) NOT NULL,
	"action" varchar(16) NOT NULL,
	"source" varchar(64) NOT NULL,
	"context" varchar(64) NOT NULL,
	"purpose" varchar(64) DEFAULT 'contract' NOT NULL,
	"scope" jsonb,
	"previous_event_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "legal_evidence_hash" CHECK ("legal_evidence_events"."document_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "legal_evidence_version" CHECK ("legal_evidence_events"."document_version" ~ '^[a-zA-Z0-9._-]{1,64}$'),
	CONSTRAINT "legal_evidence_context" CHECK ("legal_evidence_events"."source" ~ '^[a-z][a-z0-9_]{0,63}$' AND "legal_evidence_events"."context" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "legal_evidence_semantics" CHECK (("legal_evidence_events"."document_type" IN ('terms_of_use','community_guidelines','public_offer','refund_policy') AND "legal_evidence_events"."action" = 'accepted' AND "legal_evidence_events"."scope" IS NULL AND "legal_evidence_events"."purpose" = 'contract') OR ("legal_evidence_events"."document_type" IN ('personal_data_consent','personal_data_dissemination_consent') AND "legal_evidence_events"."action" IN ('granted','withdrawn') AND "legal_evidence_events"."scope" IS NOT NULL AND jsonb_typeof("legal_evidence_events"."scope") = 'object' AND ("legal_evidence_events"."scope"->>'purpose' = "legal_evidence_events"."purpose") IS TRUE AND "legal_evidence_events"."purpose" ~ '^[a-z][a-z0-9_]{0,63}$' AND "legal_evidence_events"."purpose" <> 'contract'))
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "offer_version" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "offer_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "content_rules_version" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "content_rules_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "refund_policy_version" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "refund_policy_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD CONSTRAINT "legal_evidence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_evidence_sequence_uidx" ON "legal_evidence_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "legal_evidence_stream_idx" ON "legal_evidence_events" USING btree ("user_id","document_type","purpose","sequence");--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_legal_snapshot" CHECK (("payment_orders"."offer_version" IS NULL AND "payment_orders"."offer_hash" IS NULL AND "payment_orders"."content_rules_version" IS NULL AND "payment_orders"."content_rules_hash" IS NULL AND "payment_orders"."refund_policy_version" IS NULL AND "payment_orders"."refund_policy_hash" IS NULL) OR ("payment_orders"."offer_version" IS NOT NULL AND "payment_orders"."offer_hash" IS NOT NULL AND "payment_orders"."content_rules_version" IS NOT NULL AND "payment_orders"."content_rules_hash" IS NOT NULL AND "payment_orders"."refund_policy_version" IS NOT NULL AND "payment_orders"."refund_policy_hash" IS NOT NULL AND "payment_orders"."offer_version" ~ '^[a-zA-Z0-9._-]{1,64}$' AND "payment_orders"."content_rules_version" ~ '^[a-zA-Z0-9._-]{1,64}$' AND "payment_orders"."refund_policy_version" ~ '^[a-zA-Z0-9._-]{1,64}$' AND "payment_orders"."offer_hash" ~ '^[a-f0-9]{64}$' AND "payment_orders"."content_rules_hash" ~ '^[a-f0-9]{64}$' AND "payment_orders"."refund_policy_hash" ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
CREATE TRIGGER legal_evidence_append_only BEFORE UPDATE OR DELETE ON legal_evidence_events
FOR EACH ROW EXECUTE FUNCTION reject_consent_record_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_legal_evidence_insert() RETURNS trigger AS $$
DECLARE prior legal_evidence_events%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('legal:' || NEW.user_id::text || ':' || NEW.document_type || ':' || NEW.purpose, 0));
 SELECT * INTO prior FROM legal_evidence_events WHERE user_id=NEW.user_id AND document_type=NEW.document_type AND purpose=NEW.purpose ORDER BY sequence DESC LIMIT 1;
 IF NEW.previous_event_id IS DISTINCT FROM prior.id THEN
  RAISE EXCEPTION 'legal evidence chain mismatch' USING ERRCODE='check_violation';
 END IF;
 IF NEW.action='withdrawn' AND (prior.id IS NULL OR prior.action<>'granted' OR
  (NEW.document_version,NEW.document_hash,NEW.scope) IS DISTINCT FROM (prior.document_version,prior.document_hash,prior.scope)) THEN
  RAISE EXCEPTION 'withdrawal must identify the current grant' USING ERRCODE='check_violation';
 END IF;
 IF NEW.document_type='personal_data_dissemination_consent' AND NEW.action='granted' THEN
  RAISE EXCEPTION 'dissemination is not enabled' USING ERRCODE='check_violation';
 END IF;
 IF NEW.scope IS NOT NULL AND (length(NEW.scope::text)>8192 OR
  jsonb_typeof(NEW.scope->'dataItems') IS DISTINCT FROM 'array' OR
  jsonb_array_length(NEW.scope->'dataItems') NOT BETWEEN 1 AND 16 OR
  jsonb_typeof(NEW.scope->'resourceUrls') IS DISTINCT FROM 'array' OR
  jsonb_array_length(NEW.scope->'resourceUrls')>16 OR
  jsonb_typeof(NEW.scope->'conditions') IS DISTINCT FROM 'array' OR
  jsonb_array_length(NEW.scope->'conditions')>16) THEN
  RAISE EXCEPTION 'invalid consent scope' USING ERRCODE='check_violation';
 END IF;
 IF prior.id IS NOT NULL AND (NEW.action,NEW.document_version,NEW.document_hash,NEW.scope)
  IS NOT DISTINCT FROM (prior.action,prior.document_version,prior.document_hash,prior.scope) THEN
  RAISE EXCEPTION 'identical legal event already recorded' USING ERRCODE='check_violation';
 END IF;
 -- Sequence/time assigned after serialization; caller clock/order cannot override evidence.
 NEW.sequence := nextval(pg_get_serial_sequence('legal_evidence_events','sequence'));
 NEW.occurred_at := clock_timestamp();
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER legal_evidence_insert_guard BEFORE INSERT ON legal_evidence_events
FOR EACH ROW EXECUTE FUNCTION guard_legal_evidence_insert();
--> statement-breakpoint
CREATE FUNCTION require_order_legal_snapshot() RETURNS trigger AS $$
BEGIN
 IF NEW.offer_hash IS NULL OR NEW.content_rules_hash IS NULL OR NEW.refund_policy_hash IS NULL THEN
  RAISE EXCEPTION 'new orders require legal snapshot' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_orders_legal_insert_guard BEFORE INSERT ON payment_orders
FOR EACH ROW EXECUTE FUNCTION require_order_legal_snapshot();
