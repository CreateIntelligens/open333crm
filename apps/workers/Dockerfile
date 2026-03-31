FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache openssl libc6-compat

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/workers/package.json apps/workers/package.json
COPY packages/channel-plugins/package.json packages/channel-plugins/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/workers ./apps/workers
COPY packages ./packages

# Generate Prisma client, build packages in dependency order, then workers
RUN pnpm --filter @open333crm/database exec prisma generate
RUN pnpm --filter @open333crm/database build
RUN pnpm --filter @open333crm/types build
RUN pnpm --filter @open333crm/shared build
RUN pnpm --filter @open333crm/core build
RUN pnpm --filter @open333crm/channel-plugins build
RUN pnpm --filter @open333crm/workers build

ENV NODE_ENV=production

CMD ["node", "apps/workers/dist/index.js"]


