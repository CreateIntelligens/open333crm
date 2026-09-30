/**
 * 測試用：載入 repo 根目錄的 .env（與 src/index.ts 相同位置），讓需要資料庫的整合測試
 * 直接用 `pnpm test:xxx` 就能跑，而不是因為沒有先 export DATABASE_URL 就默默 SKIP。
 * 已存在的環境變數不會被覆蓋（CI 注入的值優先）。
 */
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(here, '..', '..', '..', '..', '..', '.env') });
