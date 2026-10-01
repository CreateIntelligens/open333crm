/**
 * 測試用：載入 repo 根目錄的 .env（與 src/index.ts 相同位置），讓需要資料庫的整合測試
 * 直接用 `pnpm test:xxx` 就能跑，而不是因為沒有先 export DATABASE_URL 就默默 SKIP。
 *
 * 安全閥：這些測試會寫入資料（建立角色、渠道、改租戶設定）。
 * - DATABASE_URL 是呼叫端明確給的（環境變數）→ 照用（CI／刻意指定）
 * - DATABASE_URL 是從 .env 讀來的 → 只允許本機資料庫；指向其他主機（例如除錯時把 .env 接到 UAT）
 *   就清掉，讓測試 SKIP，避免不小心寫進 UAT／正式環境
 * 已存在的環境變數不會被 .env 覆蓋。
 */
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const explicitDatabaseUrl = process.env.DATABASE_URL;
const here = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(here, '..', '..', '..', '..', '..', '.env') });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

if (!explicitDatabaseUrl && process.env.DATABASE_URL) {
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    host = '';
  }
  if (!LOCAL_HOSTS.has(host)) {
    console.log(`[測試] .env 的 DATABASE_URL 指向「${host || '無法解析'}」而非本機，為避免寫入遠端資料庫，不使用。`);
    delete process.env.DATABASE_URL;
  }
}
