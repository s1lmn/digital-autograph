-- Applied by the operator ONLY after the reviewed migrations. No blanket future grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
GRANT USAGE ON SCHEMA public TO da_api, da_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, da_api, da_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, da_api, da_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT SELECT ON users,social_identities,sessions,oauth_login_attempts,user_roles,creators,creator_profiles,
 walls,slots,placements,wall_free_claims,autographs,autograph_assets,autograph_processing_jobs,
 autograph_storage_leases,original_upload_tombstones,autograph_user_approvals,autograph_moderation_decisions,
 legal_evidence_events,age_declarations,checkout_confirmations,pricing_config_versions,platform_pricing_default,
 takeover_quotes,takeover_reservations,payment_orders,payments,payment_event_receipts,creator_earnings,
 notification_events,notification_deliveries,notification_preferences,notification_subscriptions,share_links,share_interactions TO da_api;
GRANT INSERT ON users,social_identities,sessions,oauth_login_attempts,walls,slots,placements,wall_free_claims,
 autographs,autograph_assets,autograph_processing_jobs,autograph_storage_leases,autograph_user_approvals,
 autograph_moderation_decisions,legal_evidence_events,age_declarations,checkout_confirmations,pricing_config_versions,
 platform_pricing_default,takeover_quotes,takeover_reservations,payment_orders,payments,payment_event_receipts,
 creator_earnings,notification_events,notification_subscriptions,share_links,share_interactions TO da_api;
GRANT INSERT(user_id) ON notification_preferences TO da_api;
GRANT UPDATE ON walls,autographs,autograph_assets,takeover_reservations,payment_orders,payments,notification_preferences TO da_api;
GRANT UPDATE(updated_at) ON users,creators TO da_api;
GRANT UPDATE(revoked_at) ON sessions,share_links TO da_api;
GRANT UPDATE(consumed_at) ON oauth_login_attempts TO da_api;
GRANT UPDATE(position) ON slots TO da_api;
GRANT UPDATE(ended_at,end_reason) ON placements TO da_api;
GRANT UPDATE(slot) ON autograph_storage_leases TO da_api;
GRANT UPDATE(pricing_config_id,updated_at) ON platform_pricing_default TO da_api;
GRANT UPDATE(processed_at,result) ON payment_event_receipts TO da_api;
GRANT UPDATE(read_at,state) ON notification_deliveries TO da_api;
GRANT DELETE ON slots,autograph_storage_leases,notification_subscriptions TO da_api;
GRANT USAGE ON SEQUENCE legal_evidence_events_sequence_seq TO da_api;

GRANT SELECT ON users,walls,slots,placements,pricing_config_versions,autographs,autograph_assets,
 autograph_processing_jobs,autograph_processing_artifacts,autograph_storage_leases,autograph_cleanup_schedule,
 original_upload_tombstones,oauth_login_attempts,notification_events,notification_deliveries,
 notification_preferences,notification_subscriptions TO da_worker;
GRANT INSERT ON autograph_assets,autograph_processing_artifacts,autograph_storage_leases,
 original_upload_tombstones,notification_events,notification_deliveries TO da_worker;
GRANT INSERT(user_id) ON notification_preferences TO da_worker;
GRANT UPDATE ON autograph_processing_jobs,autograph_processing_artifacts,notification_deliveries TO da_worker;
GRANT UPDATE(status) ON autographs TO da_worker;
GRANT UPDATE(retired_at) ON autograph_assets TO da_worker;
GRANT UPDATE(slot) ON autograph_storage_leases TO da_worker;
GRANT UPDATE(next_source) ON autograph_cleanup_schedule TO da_worker;
GRANT UPDATE(next_check_at) ON original_upload_tombstones TO da_worker;
GRANT UPDATE(processed_at) ON notification_events TO da_worker;
-- PostgreSQL row locks require UPDATE on at least one column. These are explicit exceptions.
GRANT UPDATE(web) ON notification_preferences TO da_worker;
GRANT UPDATE(consumed_at) ON oauth_login_attempts TO da_worker;
GRANT DELETE ON autograph_assets,autograph_storage_leases,oauth_login_attempts TO da_worker;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' LOOP
  EXECUTE format('GRANT USAGE ON TYPE public.%I TO da_api,da_worker',item.typname);
 END LOOP;
 FOR item IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prorettype='trigger'::regtype LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO da_api,da_worker',item.name);
 END LOOP;
END $$;
COMMIT;
