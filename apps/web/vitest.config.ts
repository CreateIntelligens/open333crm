import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Only a unit suite: nothing in this package needs PostgreSQL or Redis to test.
// A component test (*.test.tsx) renders React in jsdom. It declares the environment
// on its first line: `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: {
    // Tests import source through `#src/`. Source files import each other through `@/`.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup/jsdom.ts'],
        },
      },
    ],
  },
});
