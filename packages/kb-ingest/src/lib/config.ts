/**
 * 集中管理 kb-ingest 管線的環境設定與路徑常數。
 *
 * 設計原則：kb-ingest 是「離線批次腳本」，刻意不 import apps/api 的 config 鏈，
 * 只讀 root `.env`（用 dotenv 載入）＋ process.env，依賴面最小，最穩健。
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** monorepo 根目錄（.claude 那層），src/lib 往上三層。 */
export const REPO_ROOT = resolve(__dirname, '../../../..');

// 載入 monorepo 根目錄的 .env（DATABASE_URL / GEMINI_API_KEY / OLLAMA_* 都在這）
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

/** 大同逐字稿原始資料夾（在 opencrm_poc 下，非 .claude 內）。 */
export const TRANSCRIPT_DIR = resolve(REPO_ROOT, '../大同逐字稿');

/** 管線所有中間檔的輸出目錄（不進 git，見 .gitignore）。 */
export const DATA_DIR = resolve(__dirname, '../../data');

/** 根目錄既有的參考檔（缺料清單、KB 全量、UAT 測試集）。 */
export const REF = {
  gapList: resolve(REPO_ROOT, '../KB缺料清單_20260622.csv'),
  kbFull: resolve(REPO_ROOT, '../UAT_知識庫全部_20260622.csv'),
  uatQa: resolve(REPO_ROOT, '../UAT_KB_AI_QA_100.csv'),
};

/** 各階段中間檔路徑。 */
export const FILES = {
  scanned: resolve(DATA_DIR, '01-scanned.jsonl'),
  candidates: resolve(DATA_DIR, '02-candidates.jsonl'),
  extracted: resolve(DATA_DIR, '03-extracted.jsonl'),
  rejected: resolve(DATA_DIR, '03-rejected.jsonl'),
  extractProgress: resolve(DATA_DIR, '03-extract.progress'),
  embedCache: resolve(DATA_DIR, '04-embed-cache.jsonl'),
  articlesJsonl: resolve(DATA_DIR, '04-articles.jsonl'),
  articlesCsv: resolve(DATA_DIR, '04-articles.csv'),
  articlesReviewed: resolve(DATA_DIR, '04-articles.reviewed.csv'),
  reportDistribution: resolve(DATA_DIR, 'report-question-distribution.csv'),
  reportGap: resolve(DATA_DIR, 'report-gap-validation.md'),
};

/** POC 硬編租戶 ID（見 MEMORY）。 */
export const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

/** 環境設定（含合理預設）。 */
export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.KB_INGEST_GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL ?? 'bge-m3',
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? 'qwen2.5:3b',
};

/** 確保 data 目錄存在，回傳其路徑。 */
export function ensureDataDir(): string {
  mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}
