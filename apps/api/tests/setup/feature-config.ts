/**
 * Connection settings for the feature suite. Shared by the global setup (main process)
 * and feature.env.ts (each test worker).
 *
 * Feature tests never touch the development database. They use a dedicated database
 * (default `open333crm_test`) on the PostgreSQL from docker-compose.dev.yml, and a
 * dedicated Redis logical database (default 15).
 *
 * Defaults match docker-compose.dev.yml. Override with TEST_DATABASE_HOST,
 * TEST_DATABASE_NAME, TEST_DATABASE_USER, TEST_DATABASE_PASSWORD, TEST_REDIS_URL,
 * TEST_APP_TENANT_PASSWORD and TEST_APP_ADMIN_PASSWORD.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const host = process.env.TEST_DATABASE_HOST ?? 'localhost:5433';
const dbName = process.env.TEST_DATABASE_NAME ?? 'open333crm_test';
const owner = `${process.env.TEST_DATABASE_USER ?? 'crm'}:${process.env.TEST_DATABASE_PASSWORD ?? 'crmpassword'}`;

export const testDatabaseName = dbName;

export const appRolePasswords = {
  app_tenant: process.env.TEST_APP_TENANT_PASSWORD ?? 'app_tenant_local',
  app_admin: process.env.TEST_APP_ADMIN_PASSWORD ?? 'app_admin_local',
};

export const urls = {
  /** Superuser connection to the cluster's maintenance database, used to create the test database. */
  maintenance: `postgresql://${owner}@${host}/postgres`,
  /** Owner connection to the test database: migrations and fixtures. Bypasses RLS. */
  owner: `postgresql://${owner}@${host}/${dbName}`,
  /** Same connections the API uses in production: RLS enforced, and BYPASSRLS. */
  tenant: `postgresql://app_tenant:${appRolePasswords.app_tenant}@${host}/${dbName}`,
  admin: `postgresql://app_admin:${appRolePasswords.app_admin}@${host}/${dbName}`,
  redis: process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/15',
};

/** The two tenants every feature test can rely on. */
export const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
export const TENANT_B = 'b0000000-0000-0000-0000-000000000002';

/** Refuse to run against anything but a local database, so a stray override cannot wipe a shared one. */
export function assertLocal(): void {
  for (const url of [urls.owner, urls.redis]) {
    const { hostname } = new URL(url);
    if (!LOCAL_HOSTS.has(hostname)) {
      throw new Error(`Feature tests only run against a local host; got "${hostname}" in ${url.replace(/:[^:@/]+@/, ':***@')}`);
    }
  }
}
