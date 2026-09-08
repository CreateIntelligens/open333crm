FROM node:24-bookworm-slim AS deps

WORKDIR /app

RUN corepack enable

# Alpine deps for Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl ca-certificates curl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy manifests for all workspace packages that api depends on
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/automation/package.json packages/automation/package.json
COPY packages/channel-plugins/package.json packages/channel-plugins/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/types/package.json packages/types/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts
# Magika uses a TensorFlow native addon. Node 24 ARM64 has no prebuilt tfjs-node
# binary, so fetch the matching TensorFlow C library/header at build time and
# compile just this addon. Runtime uses only the resulting local artifacts.
RUN TFJS_NODE_DIR="$(realpath /app/apps/api/node_modules/@tensorflow/tfjs-node)" \
  && case "$(dpkg --print-architecture)" in \
    arm64) TF_LIB_URL="https://storage.googleapis.com/tf-builds/libtensorflow_r2_7_linux_arm64.tar.gz" ;; \
    amd64) TF_LIB_URL="https://storage.googleapis.com/tensorflow/libtensorflow/libtensorflow-cpu-linux-x86_64-2.9.1.tar.gz" ;; \
    *) echo "Unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
  esac \
  && mkdir -p "$TFJS_NODE_DIR/deps" \
  && curl -fsSL "$TF_LIB_URL" | tar -xz -C "$TFJS_NODE_DIR/deps" \
  && cd "$TFJS_NODE_DIR" \
  && /app/node_modules/.pnpm/node_modules/.bin/node-pre-gyp install --build-from-source \
  && test -f "$TFJS_NODE_DIR/lib/napi-v8/tfjs_binding.node"

# ---- Builder ----
FROM deps AS builder

COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages

# Generate Prisma client, then build packages in dependency order
RUN pnpm --filter @open333crm/database exec prisma generate
RUN pnpm --filter @open333crm/database build
RUN pnpm --filter @open333crm/types build
RUN pnpm --filter @open333crm/shared build
RUN pnpm --filter @open333crm/automation build
RUN pnpm --filter @open333crm/core build
RUN pnpm --filter @open333crm/channel-plugins build
RUN pnpm --filter @open333crm/api build

# ---- Runner ----
FROM node:24-bookworm-slim AS runner

WORKDIR /app

RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/assets ./apps/api/assets
COPY --from=builder /app/packages ./packages
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x apps/api/docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3001

CMD ["sh", "apps/api/docker-entrypoint.sh"]
