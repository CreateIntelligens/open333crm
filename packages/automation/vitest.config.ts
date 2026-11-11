import { defineConfig } from 'vitest/config';

// 只有 unit：這個套件的測試不需要 PostgreSQL 或 Redis。
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
