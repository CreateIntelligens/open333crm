import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

// Load env BEFORE any module that reads process.env at import time (e.g. BullMQ
// queues constructed with `connection: { url: process.env.REDIS_URL }`).
// workers 是 ESM：靜態 import 的模組都比 index.ts 本身的程式先執行，所以載入 .env 要放在這個
// 模組，並由 index.ts 第一個 import。
// Walk up from cwd until we find the monorepo root .env (covers both dev
// where cwd=apps/workers and prod where it might be the package dir).
export function loadEnv(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config(); // fall back to default (cwd/.env)
}
loadEnv();
