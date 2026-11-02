import { RUNTIME_ROLE, type Migration } from '@rifad/database';

/**
 * Migrations owned by the Organizations context. Immutable once deployed; IDs continue the global
 * sequence after the platform migrations and run through the same migrator.
 */
export const ORGANIZATIONS_MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    id: '0007_organizations_core',
    owner: 'organizations',
    sql: `
      CREATE SCHEMA organizations;
      REVOKE ALL ON SCHEMA organizations FROM PUBLIC;
      GRANT USAGE ON SCHEMA organizations TO ${RUNTIME_ROLE};

      -- The organization row is its own tenant: organization_id is both key and RLS boundary.
      CREATE TABLE organizations.organization (
        organization_id uuid PRIMARY KEY,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
        timezone text NOT NULL,
        version integer NOT NULL CHECK (version > 0),
        created_at timestamptz NOT NULL
      );
      CREATE TABLE organizations.branch (
        organization_id uuid NOT NULL REFERENCES organizations.organization (organization_id),
        branch_id uuid NOT NULL,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        status text NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
        timezone text,
        version integer NOT NULL CHECK (version > 0),
        PRIMARY KEY (organization_id, branch_id),
        CONSTRAINT branch_id_unique UNIQUE (branch_id)
      );
      CREATE TABLE organizations.membership (
        organization_id uuid NOT NULL REFERENCES organizations.organization (organization_id),
        membership_id uuid NOT NULL,
        user_id uuid NOT NULL,
        status text NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED')),
        version integer NOT NULL CHECK (version > 0),
        PRIMARY KEY (organization_id, membership_id)
      );
      -- One live membership per user and organization (G13); ENDED rows stay as history.
      CREATE UNIQUE INDEX membership_live_user ON organizations.membership (organization_id, user_id) WHERE status <> 'ENDED';

      ALTER TABLE organizations.organization ENABLE ROW LEVEL SECURITY;
      ALTER TABLE organizations.organization FORCE ROW LEVEL SECURITY;
      ALTER TABLE organizations.branch ENABLE ROW LEVEL SECURITY;
      ALTER TABLE organizations.branch FORCE ROW LEVEL SECURITY;
      ALTER TABLE organizations.membership ENABLE ROW LEVEL SECURITY;
      ALTER TABLE organizations.membership FORCE ROW LEVEL SECURITY;
      CREATE POLICY organization_tenant ON organizations.organization
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
      CREATE POLICY branch_tenant ON organizations.branch
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
      CREATE POLICY membership_tenant ON organizations.membership
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());

      -- No DELETE: organizations, branches and memberships change status, history is kept.
      GRANT SELECT, INSERT ON organizations.organization, organizations.branch, organizations.membership TO ${RUNTIME_ROLE};
      GRANT UPDATE (name, status, timezone, version) ON organizations.organization TO ${RUNTIME_ROLE};
      GRANT UPDATE (name, status, timezone, version) ON organizations.branch TO ${RUNTIME_ROLE};
      GRANT UPDATE (status, version) ON organizations.membership TO ${RUNTIME_ROLE};
    `,
  },
]);
