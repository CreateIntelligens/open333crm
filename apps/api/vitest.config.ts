import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Two suites, in the spirit of Laravel's tests/Unit and tests/Feature:
//   unit    — no external services; dependencies are injected as mocks.
//   feature — needs PostgreSQL and Redis (docker-compose.dev.yml). Runs against a
//             dedicated test database that the global setup migrates and seeds.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup/unit.setup.ts'],
          // unit.setup.ts 的 mock 要套用到 workspace 套件（例如 core 的 redis），這些套件要由 vite 處理：
          // - core 等 ESM 套件設成 inline。
          // - channel-plugins 編成 CJS，dist 用 require() 載入 core，vite 攔不到，會由 Node 另外載入
          //   一份真的 core 並連到 Redis。所以改用它的 TypeScript 原始碼。
          server: { deps: { inline: [/\/packages\/[^/]+\/dist\//] } },
          alias: [
            {
              find: /^@open333crm\/channel-plugins$/,
              replacement: fileURLToPath(new URL('../../packages/channel-plugins/src/index.ts', import.meta.url)),
            },
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'feature',
          include: ['tests/feature/**/*.test.ts'],
          globalSetup: ['tests/setup/feature.global-setup.ts'],
          setupFiles: ['tests/setup/feature.env.ts'],
          // Feature tests share one database, so files run one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
