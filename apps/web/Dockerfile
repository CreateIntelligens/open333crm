FROM node:20-alpine

WORKDIR /app

# Enable pnpm
RUN corepack enable

# Install dependencies (monorepo)
COPY package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/channel-plugins/package.json packages/channel-plugins/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN cat > pnpm-workspace.yaml <<'EOF_PNPM'
packages:
  - "apps/web"
  - "packages/*"
EOF_PNPM
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

EXPOSE 3001

CMD ["pnpm", "--filter", "@open333crm/web", "dev"]
