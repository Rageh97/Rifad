import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// First-tenant bootstrap (M0-039) without manual database edits:
//   pnpm admin:bootstrap -- --org "Name" --timezone Asia/Riyadh --branch "Main" --issuer <oidc issuer> --subject <oidc sub>
// Creates the owner's platform user mapping, the organization, one branch, an ACTIVE membership, an
// Owner role with every known permission, an organization-wide assignment and every module entitlement.
// Each step is audited. Local/test only: RIFAD_DATABASE_OWNER_URL must point to a loopback server.
// Run `pnpm build` and `pnpm db:migrate` first. Prints one JSON line with the created IDs.
const require = createRequire(import.meta.url);
const fail = code => { console.error(JSON.stringify({ event: 'admin.bootstrap.failed', code })); process.exit(1); };
const args = process.argv.slice(2).filter(arg => arg !== '--');
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = { org: option('--org'), timezone: option('--timezone'), branch: option('--branch'), issuer: option('--issuer'), subject: option('--subject') };
if (Object.values(input).some(value => !value)) fail('USAGE');
const value = process.env.RIFAD_DATABASE_OWNER_URL;
let url;
try { url = new URL(value ?? ''); } catch { url = undefined; }
if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) fail('INVALID_OWNER_URL');

const lib = path => require(`../libs/${path}/dist/index.js`);
const { createDatabase } = lib('shared/database');
const { systemClock } = lib('shared/kernel');
const { createRequestContext, runWithContext } = lib('shared/request-context');
const { postgresAuditSinkFactory } = lib('platform/audit/infrastructure');
const { provisionExternalIdentity } = lib('platform/identity/infrastructure');
const { organizationsService } = lib('platform/organizations/application');
const { postgresOrganizationDirectory, postgresOrganizationsUnitOfWork } = lib('platform/organizations/infrastructure');
const { authorizationService } = lib('platform/authorization/application');
const { PERMISSIONS } = lib('platform/authorization/contract');
const { postgresAuthorizationUnitOfWork } = lib('platform/authorization/infrastructure');
const { entitlementsService } = lib('platform/entitlements/application');
const { FEATURES } = lib('platform/entitlements/contract');
const { postgresEntitlementsUnitOfWork } = lib('platform/entitlements/infrastructure');

const database = createDatabase(value, { applicationName: 'rifad-admin-bootstrap', maxConnections: 2 });
const db = database.db;
try {
  await runWithContext(createRequestContext({ correlationId: 'admin-bootstrap' }), async () => {
    const userId = randomUUID();
    await provisionExternalIdentity(db, { issuer: input.issuer, subject: input.subject, userId });

    const organizations = organizationsService(postgresOrganizationsUnitOfWork(db, postgresAuditSinkFactory), systemClock);
    const organization = await organizations.createOrganization({ name: input.org, timezone: input.timezone });
    const branch = await organizations.openBranch(organization.organizationId, { name: input.branch });
    const invited = await organizations.inviteMember(organization.organizationId, userId);
    const membership = await organizations.changeMembershipStatus(organization.organizationId, invited.membershipId, 'ACTIVE');

    const authorization = authorizationService(postgresAuthorizationUnitOfWork(db, postgresAuditSinkFactory), postgresOrganizationDirectory(db));
    const role = await authorization.defineRole(organization.organizationId, { name: 'Owner', permissions: [...PERMISSIONS] });
    await authorization.assignRole(organization.organizationId, { membershipId: membership.membershipId, roleId: role.roleId, scope: { kind: 'ORGANIZATION' } });

    const entitlements = entitlementsService(postgresEntitlementsUnitOfWork(db, postgresAuditSinkFactory));
    for (const feature of FEATURES) await entitlements.set(organization.organizationId, feature, true);

    console.log(JSON.stringify({ event: 'admin.bootstrap.completed', userId, organizationId: organization.organizationId, branchId: branch.branchId,
      membershipId: membership.membershipId, roleId: role.roleId }));
  });
} catch (error) {
  console.error(JSON.stringify({ event: 'admin.bootstrap.failed', code: error?.code ?? error?.name ?? 'FAILED' }));
  process.exitCode = 1;
} finally {
  await database.close();
}
