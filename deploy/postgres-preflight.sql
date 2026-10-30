-- Read-only, dedicated application DB acceptance. Unknown objects require explicit review.
DO $$
DECLARE role_oid oid;
BEGIN
 IF EXISTS (SELECT FROM pg_namespace WHERE nspname NOT IN ('public','drizzle','information_schema') AND nspname !~ '^pg_')
 OR EXISTS (SELECT FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a WHERE n.nspname<>'public' AND a.grantee=0 AND a.privilege_type='CREATE')
 OR EXISTS (SELECT FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','drizzle') AND ((t.typtype='e' AND t.typname NOT IN ('administrative_role','autograph_asset_role','autograph_asset_status','autograph_moderation_decision','autograph_moderation_reason','autograph_processing_job_status','autograph_source','autograph_status','payment_state','placement_source','takeover_reservation_status','user_status','wall_status')) OR t.typtype IN ('d','r','m') OR (t.typtype='b' AND t.typelem=0)))
 OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relkind='S' AND c.relname<>'legal_evidence_events_sequence_seq') OR (n.nspname='drizzle' AND c.relkind NOT IN ('i') AND c.relname NOT IN ('__drizzle_migrations','__drizzle_migrations_id_seq')))
 OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname IN ('public','drizzle') AND r.rolname NOT IN (current_user,'da_migrator','pg_database_owner'))
 OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname NOT IN (current_user,'da_migrator'))
 OR EXISTS (SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname IN ('public','drizzle') AND r.rolname NOT IN (current_user,'da_migrator','pg_database_owner'))
 OR EXISTS (SELECT FROM pg_event_trigger)
 OR EXISTS (SELECT FROM pg_extension WHERE extname <> 'plpgsql')
 OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND
   (c.relkind NOT IN ('r','i','S') OR (c.relkind='r' AND c.relname NOT IN ('age_declarations','autograph_assets','autograph_cleanup_schedule','autograph_moderation_decisions','autograph_processing_artifacts','autograph_processing_jobs','autograph_storage_leases','autograph_user_approvals','autographs','checkout_confirmations','consent_records','creator_earnings','creator_profiles','creators','legal_evidence_events','notification_deliveries','notification_events','notification_preferences','notification_subscriptions','oauth_login_attempts','original_upload_tombstones','payment_event_receipts','payment_orders','payments','placements','platform_pricing_default','pricing_config_versions','sessions','share_interactions','share_links','slots','social_identities','takeover_quotes','takeover_reservations','user_roles','users','wall_free_claims','walls'))))
 OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
    (n.nspname='public' AND (p.proname NOT IN ('guard_age_declaration_insert','guard_checkout_confirmation_insert','guard_creator_earning','guard_legal_evidence_insert','guard_payment_attempt','guard_payment_order','guard_placement_history','guard_takeover_reservation_mutation','guard_wall_pricing_pin','notification_payment_fact','notification_placement_fact','reject_approved_cleaned_asset_mutation','reject_autograph_moderation_decision_mutation','reject_autograph_user_approval_mutation','reject_consent_record_mutation','reject_pricing_evidence_mutation','reject_wall_free_claim_mutation','require_checkout_confirmation','require_order_legal_snapshot','touch_updated_at','verify_payment_aggregate') OR p.prokind<>'f' OR p.pronargs<>0 OR p.prorettype<>'trigger'::regtype OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prosecdef))
    OR n.nspname='drizzle' OR (n.nspname<>'public' AND p.prosecdef))
 OR EXISTS (SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT t.tgisinternal AND (n.nspname<>'public' OR p.proname NOT IN ('guard_age_declaration_insert','guard_checkout_confirmation_insert','guard_creator_earning','guard_legal_evidence_insert','guard_payment_attempt','guard_payment_order','guard_placement_history','guard_takeover_reservation_mutation','guard_wall_pricing_pin','notification_payment_fact','notification_placement_fact','reject_approved_cleaned_asset_mutation','reject_autograph_moderation_decision_mutation','reject_autograph_user_approval_mutation','reject_consent_record_mutation','reject_pricing_evidence_mutation','reject_wall_free_claim_mutation','require_checkout_confirmation','require_order_legal_snapshot','touch_updated_at','verify_payment_aggregate') OR p.prosecdef))
 THEN RAISE EXCEPTION 'Unreviewed database objects; no schema/ACL transition allowed'; END IF;
 FOR role_oid IN SELECT oid FROM pg_roles WHERE rolname IN ('da_api','da_worker','da_migrator') LOOP
   IF EXISTS (SELECT FROM pg_roles WHERE oid=role_oid AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
   OR EXISTS (SELECT FROM pg_auth_members WHERE member=role_oid OR roleid=role_oid)
   OR EXISTS (SELECT FROM pg_db_role_setting WHERE setrole=role_oid AND cardinality(setconfig)>0)
   THEN RAISE EXCEPTION 'Unsafe existing role authority/settings'; END IF;
 END LOOP;
 FOR role_oid IN SELECT oid FROM pg_roles WHERE rolname IN ('da_api','da_worker') LOOP
   IF EXISTS (SELECT FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=role_oid AND deptype='o')
   OR EXISTS (SELECT FROM pg_database d, LATERAL aclexplode(d.datacl) a WHERE d.datname<>current_database() AND (a.grantee=role_oid OR a.grantor=role_oid))
   OR EXISTS (SELECT FROM pg_tablespace t, LATERAL aclexplode(t.spcacl) a WHERE a.grantee=role_oid OR a.grantor=role_oid)
   OR EXISTS (SELECT FROM pg_foreign_data_wrapper f, LATERAL aclexplode(f.fdwacl) a WHERE a.grantee=role_oid OR a.grantor=role_oid)
   OR EXISTS (SELECT FROM pg_foreign_server f, LATERAL aclexplode(f.srvacl) a WHERE a.grantee=role_oid OR a.grantor=role_oid)
   OR EXISTS (SELECT FROM pg_largeobject_metadata l, LATERAL aclexplode(l.lomacl) a WHERE a.grantee=role_oid OR a.grantor=role_oid)
   OR EXISTS (SELECT FROM pg_parameter_acl p, LATERAL aclexplode(p.paracl) a WHERE a.grantee IN (0,role_oid) OR a.grantor=role_oid)
   OR EXISTS (SELECT FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a WHERE a.grantee=role_oid AND d.defaclrole NOT IN (SELECT oid FROM pg_roles WHERE rolname IN (current_user,'da_migrator')))
   THEN RAISE EXCEPTION 'Unreviewed runtime ownership or external authority'; END IF;
   IF EXISTS (SELECT FROM (
     SELECT datacl AS acl FROM pg_database WHERE datname=current_database()
     UNION ALL SELECT nspacl FROM pg_namespace
     UNION ALL SELECT proacl FROM pg_proc
     UNION ALL SELECT relacl FROM pg_class
     UNION ALL SELECT attacl FROM pg_attribute
     UNION ALL SELECT typacl FROM pg_type
     UNION ALL SELECT lanacl FROM pg_language
     UNION ALL SELECT defaclacl FROM pg_default_acl
   ) aclset, LATERAL aclexplode(aclset.acl) a WHERE a.grantor=role_oid OR (a.grantee=role_oid AND a.is_grantable))
   THEN RAISE EXCEPTION 'Runtime delegation requires independent ACL analysis'; END IF;
 END LOOP;
END $$;
