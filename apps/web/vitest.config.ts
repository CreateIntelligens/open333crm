import { defineConfig } from 'vitest/config';

// Only a unit suite: nothing in this package needs PostgreSQL or Redis to test.
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
    ],
  },
});
