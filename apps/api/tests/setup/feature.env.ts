/**
 * Runs in every feature-test worker before the test files load. Points the code under
 * test at the test database and test Redis, overriding anything inherited from the shell,
 * so a feature test can never write to the development database.
 */
import { TENANT_A, TENANT_B, urls } from './feature-config.js';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: urls.owner,
  DATABASE_URL_TENANT: urls.tenant,
  DATABASE_URL_ADMIN: urls.admin,
  REDIS_URL: urls.redis,
  RLS_TEST_TENANT_A: TENANT_A,
  RLS_TEST_TENANT_B: TENANT_B,
});

// Required by src/config/env.ts. Test-only values; keep any value the caller set.
process.env.JWT_SECRET ??= 'feature-test-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'feature-test-credential-encryption-key!!';
