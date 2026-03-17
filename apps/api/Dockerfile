FROM node:20-alpine

WORKDIR /app

# Enable pnpm
RUN corepack enable

# Prisma engine runtime dependencies (Alpine)
RUN apk add --no-cache openssl libc6-compat

# Install dependencies (monorepo)
COPY package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/channel-plugins/package.json packages/channel-plugins/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN cat > pnpm-workspace.yaml <<'EOF_PNPM'
packages:
  - "apps/api"
  - "packages/*"
EOF_PNPM
RUN pnpm install --frozen-lockfile

# Copy base config
COPY tsconfig.base.json ./

# Copy only required source code
COPY apps/api ./apps/api
COPY packages ./packages

EXPOSE 3000 5555

CMD ["sh", "-c", "pnpm --filter @open333crm/api run prisma:generate && pnpm --filter @open333crm/api run prisma:migrate:deploy && pnpm --filter @open333crm/api dev"]
