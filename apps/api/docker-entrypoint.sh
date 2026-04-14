#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
/app/node_modules/.bin/prisma migrate deploy \
  --schema /app/packages/database/prisma/schema.prisma
echo "[entrypoint] Migrations complete."

echo "[entrypoint] Running database seed..."
/app/packages/database/node_modules/.bin/tsx /app/packages/database/prisma/seed.ts \
  && echo "[entrypoint] Seed complete." \
  || echo "[entrypoint] Seed skipped or failed (non-fatal)."

echo "[entrypoint] Starting API..."
exec node /app/apps/api/dist/index.js
