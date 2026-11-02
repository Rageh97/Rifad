import { createRequire } from 'node:module';

// Applies pending migrations as the owner/migration role (never the runtime role).
// Local/test only: RIFAD_DATABASE_OWNER_URL must point to a loopback server. Run `pnpm build` first.
const require = createRequire(import.meta.url);
const value = process.env.RIFAD_DATABASE_OWNER_URL;
let url;
try { url = new URL(value ?? ''); } catch { url = undefined; }
if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  console.error(JSON.stringify({ event: 'db.migrate.failed', code: 'INVALID_OWNER_URL' }));
  process.exit(1);
}
const { createDatabase, migrate, MIGRATIONS } = require('../libs/shared/database/dist/index.js');
// Every context's migrations run through one migrator in global ID order (platform first).
const { ORGANIZATIONS_MIGRATIONS } = require('../libs/platform/organizations/infrastructure/dist/index.js');
const { IDENTITY_MIGRATIONS } = require('../libs/platform/identity/infrastructure/dist/index.js');
const { AUTHORIZATION_MIGRATIONS } = require('../libs/platform/authorization/infrastructure/dist/index.js');
const { ENTITLEMENTS_MIGRATIONS } = require('../libs/platform/entitlements/infrastructure/dist/index.js');
const { AUDIT_MIGRATIONS } = require('../libs/platform/audit/infrastructure/dist/index.js');
const migrations = [...MIGRATIONS, ...ORGANIZATIONS_MIGRATIONS, ...IDENTITY_MIGRATIONS, ...AUTHORIZATION_MIGRATIONS, ...ENTITLEMENTS_MIGRATIONS, ...AUDIT_MIGRATIONS];
const database = createDatabase(value, { applicationName: 'rifad-migrate', maxConnections: 1 });
try {
  const applied = await migrate(database.db, migrations);
  console.log(JSON.stringify({ event: 'db.migrate.completed', applied }));
} catch (error) {
  console.error(JSON.stringify({ event: 'db.migrate.failed', code: error?.code ?? error?.name ?? 'MIGRATION_FAILED' }));
  process.exitCode = 1;
} finally {
  await database.close();
}
