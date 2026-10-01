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
