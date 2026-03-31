FROM node:20-alpine AS deps

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- Builder ----
FROM deps AS builder

COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/types ./packages/types
COPY packages/ui ./packages/ui

RUN pnpm --filter @open333crm/types build
RUN pnpm --filter @open333crm/web build

# ---- Runner ----
FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/packages/ui ./packages/ui

ENV NODE_ENV=production

EXPOSE 3000

CMD ["pnpm", "--filter", "@open333crm/web", "start"]

