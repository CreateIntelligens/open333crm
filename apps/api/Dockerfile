FROM node:20-alpine AS deps

WORKDIR /app

RUN corepack enable

# Alpine deps for Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy manifests for all workspace packages that api depends on
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/widget/package.json apps/widget/package.json
COPY packages/channel-plugins/package.json packages/channel-plugins/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- Builder ----
FROM deps AS builder

COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/widget ./apps/widget
COPY packages ./packages

# Generate Prisma client, then build packages in dependency order
RUN pnpm --filter @open333crm/database exec prisma generate
RUN pnpm --filter @open333crm/database build
RUN pnpm --filter @open333crm/types build
RUN pnpm --filter @open333crm/shared build
RUN pnpm --filter @open333crm/core build
RUN pnpm --filter @open333crm/channel-plugins build
RUN pnpm --filter @open333crm/api build
RUN pnpm --filter @open333crm/widget build

# ---- Runner ----
FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache openssl libc6-compat

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/widget/dist ./apps/widget/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages ./packages
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x apps/api/docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3001

CMD ["sh", "apps/api/docker-entrypoint.sh"]

