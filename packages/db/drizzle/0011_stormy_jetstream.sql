CREATE TABLE "wall_free_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wall_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"autograph_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wall_free_claims" ADD CONSTRAINT "wall_free_claims_wall_id_walls_id_fk" FOREIGN KEY ("wall_id") REFERENCES "public"."walls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_free_claims" ADD CONSTRAINT "wall_free_claims_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_free_claims" ADD CONSTRAINT "wall_free_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_free_claims" ADD CONSTRAINT "wall_free_claims_autograph_id_autographs_id_fk" FOREIGN KEY ("autograph_id") REFERENCES "public"."autographs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_free_claims" ADD CONSTRAINT "wall_free_claims_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wall_free_claims_wall_user_uidx" ON "wall_free_claims" USING btree ("wall_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wall_free_claims_placement_uidx" ON "wall_free_claims" USING btree ("placement_id");--> statement-breakpoint
CREATE INDEX "wall_free_claims_user_time_idx" ON "wall_free_claims" USING btree ("user_id","claimed_at");--> statement-breakpoint
CREATE INDEX "wall_free_claims_slot_idx" ON "wall_free_claims" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "wall_free_claims_autograph_idx" ON "wall_free_claims" USING btree ("autograph_id");
--> statement-breakpoint
CREATE FUNCTION reject_wall_free_claim_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wall free claims are append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER wall_free_claims_append_only BEFORE UPDATE OR DELETE ON wall_free_claims
FOR EACH ROW EXECUTE FUNCTION reject_wall_free_claim_mutation();
