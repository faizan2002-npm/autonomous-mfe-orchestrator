-- Move pre-tenancy data into a "Demo Organization" with one consumer for its unattributed
-- traffic. Fresh databases have no rows to move, so nothing is created there.
DO $$
DECLARE
  demo_org uuid := '00000000-0000-4000-a000-000000000001';
  legacy_consumer uuid := '00000000-0000-4000-a000-000000000002';
BEGIN
  IF EXISTS (SELECT 1 FROM service_registries WHERE org_id IS NULL) THEN
    INSERT INTO organizations (id, slug, name)
    VALUES (demo_org, 'demo', 'Demo Organization')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO consumers (id, org_id, name, kind, description)
    VALUES (legacy_consumer, demo_org, 'legacy-traffic', 'frontend',
            'Traffic recorded before consumer API keys existed.')
    ON CONFLICT (id) DO NOTHING;

    UPDATE service_registries SET org_id = demo_org WHERE org_id IS NULL;
    INSERT INTO consumer_services (consumer_id, service_id)
      SELECT legacy_consumer, id FROM service_registries WHERE org_id = demo_org
      ON CONFLICT DO NOTHING;
    UPDATE api_contracts SET org_id = demo_org, consumer_id = legacy_consumer WHERE org_id IS NULL;
    UPDATE drift_events SET org_id = demo_org, consumer_id = legacy_consumer WHERE org_id IS NULL;
    UPDATE patch_registries SET org_id = demo_org, consumer_id = legacy_consumer WHERE org_id IS NULL;
    UPDATE governance_audits SET org_id = demo_org WHERE org_id IS NULL;
  END IF;
END $$;
