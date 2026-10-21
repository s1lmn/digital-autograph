CREATE TABLE "age_declarations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"minimum_age" integer DEFAULT 18 NOT NULL,
	"declared_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"source" varchar(64) DEFAULT 'web' NOT NULL,
	"context" varchar(64) DEFAULT 'first_use' NOT NULL,
	CONSTRAINT "age_declaration_semantics" CHECK ("age_declarations"."minimum_age" = 18 AND "age_declarations"."source" = 'web' AND "age_declarations"."context" = 'first_use')
);
--> statement-breakpoint
ALTER TABLE "age_declarations" ADD CONSTRAINT "age_declarations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER age_declarations_append_only BEFORE UPDATE OR DELETE ON age_declarations
FOR EACH ROW EXECUTE FUNCTION reject_consent_record_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_age_declaration_insert() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND status='active' FOR SHARE) THEN
  RAISE EXCEPTION 'active subject required' USING ERRCODE='check_violation';
 END IF;
 NEW.declared_at := clock_timestamp();
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER age_declarations_insert_guard BEFORE INSERT ON age_declarations
FOR EACH ROW EXECUTE FUNCTION guard_age_declaration_insert();
