/**
 * Runs once before the feature suite, in the spirit of Laravel's RefreshDatabase:
 *   1. create the test database if it does not exist;
 *   2. give the RLS roles a password if they have none (local clusters only);
 *   3. apply every migration;
 *   4. insert the fixture tenants;
 *   5. empty the test Redis database.
 * Individual tests keep their own data isolated, e.g. by running inside a rolled-back transaction.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import { TENANT_A, TENANT_B, appRolePasswords, assertLocal, testDatabaseName, urls } from './feature-config.js';

const databasePackage = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../packages/database');

async function createDatabase() {
  const db = new PrismaClient({ datasources: { db: { url: urls.maintenance } } });
  try {
    const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${testDatabaseName}`;
    if (rows.length === 0) await db.$executeRawUnsafe(`CREATE DATABASE "${testDatabaseName}"`);
  } finally {
    await db.$disconnect();
  }
}

async function setRolePasswords() {
  const db = new PrismaClient({ datasources: { db: { url: urls.maintenance } } });
  try {
    for (const [role, password] of Object.entries(appRolePasswords)) {
      const rows = await db.$queryRaw<Array<{ has: boolean }>>`
        SELECT rolpassword IS NOT NULL AS has FROM pg_authid WHERE rolname = ${role}`;
      // A role that does not exist yet is created by the migrations; set its password on the next run.
      if (rows.length === 1 && !rows[0].has) {
        await db.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD '${password.replace(/'/g, "''")}'`);
      }
    }
  } finally {
    await db.$disconnect();
  }
}

function migrate() {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: databasePackage,
    env: { ...process.env, DATABASE_URL: urls.owner },
    stdio: 'pipe',
  });
}

async function insertFixtures() {
  const db = new PrismaClient({ datasources: { db: { url: urls.owner } } });
  try {
    for (const [id, name] of [[TENANT_A, 'Feature Test Tenant A'], [TENANT_B, 'Feature Test Tenant B']]) {
      await db.tenant.upsert({ where: { id }, update: {}, create: { id, name } });
    }
  } finally {
    await db.$disconnect();
  }
}

async function flushRedis() {
  const redis = new IORedis(urls.redis, { maxRetriesPerRequest: 1 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

export default async function setup() {
  assertLocal();
  try {
    await createDatabase();
  } catch (err) {
    throw new Error(
      'Feature tests need PostgreSQL and Redis. Start them with ' +
        '`docker compose -f docker-compose.dev.yml up -d postgres redis`.\n' +
        String(err),
    );
  }
  migrate();
  await setRolePasswords();
  await insertFixtures();
  await flushRedis();
}
