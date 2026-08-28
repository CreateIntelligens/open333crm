#!/bin/sh
set -e

# RLS 上線後，app runtime 的 DATABASE_URL 指向受 RLS 的 app_tenant（NOBYPASSRLS、非 table owner）。
# 但 migration 是 DDL（ALTER TABLE 等），必須用 table owner / superuser 連線，否則 Postgres
# 以 "must be owner of table X"（42501 / Prisma P3018）擋下。
# 因此 migrate/seed 一律走 MIGRATE_DATABASE_URL（指向 owner，如 crm）；未設才 fallback 到 DATABASE_URL
# （相容 RLS 未啟用的環境，行為不變）。
MIGRATE_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"

echo "[entrypoint] Running database migrations..."
DATABASE_URL="$MIGRATE_URL" /app/packages/database/node_modules/.bin/prisma migrate deploy \
  --schema /app/packages/database/prisma/schema.prisma
echo "[entrypoint] Migrations complete."

echo "[entrypoint] Running database seed..."
DATABASE_URL="$MIGRATE_URL" /app/packages/database/node_modules/.bin/tsx /app/packages/database/prisma/seed.ts \
  && echo "[entrypoint] Seed complete." \
  || echo "[entrypoint] Seed skipped or failed (non-fatal)."

echo "[entrypoint] Starting API..."
exec node /app/apps/api/dist/index.js
