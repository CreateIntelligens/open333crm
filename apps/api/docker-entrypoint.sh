#!/bin/sh
set -e

echo "[entrypoint] Running database seed..."
/app/packages/database/node_modules/.bin/tsx /app/packages/database/prisma/seed.ts \
  && echo "[entrypoint] Seed complete." \
  || echo "[entrypoint] Seed skipped or failed (non-fatal)."

echo "[entrypoint] Starting API..."
exec node /app/apps/api/dist/index.js
