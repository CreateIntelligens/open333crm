#!/usr/bin/env node
/**
 * 回收 #329 修正前已匿名化的客人留在物件儲存的媒體孤兒檔（issue #474，一次性腳本）。
 *
 * 背景：#329（PR #479）之前，匿名化把進站訊息改成 { redacted: true } 時沒有先讀出 content.storageKey，
 * 客人傳來的圖片、影片、檔案留在 MinIO 的 {tenantId}/media/{conversationId}/，資料庫再也找不到。
 *
 * 規則（SQL 在 scripts/sql/recover-erased-media-orphans.sql）：
 *   - 對象：status = 'completed'、mode = 'anonymize' 的資料刪除請求，其聯絡人目前的對話。
 *     硬刪除的對話已經刪除，找不到媒體目錄，只列出筆數、不處理（硬刪除本來就刪媒體檔）。
 *   - 列出每個對話的 {tenantId}/media/{conversationId}/ 底下的物件。
 *   - 只刪 {tenantId}/media/{conversationId}/{uuid}{.副檔名} 格式的 key（與 data-erasure worker 共用
 *     @open333crm/core 的 isConversationMediaKey）；不符合的略過並計數。
 *   - 同一租戶任何訊息的內容仍引用的 key 保留（客服上傳的出站媒體檔、轉傳的圖片）。
 *
 * 安全設計：
 *   - 預設 dry-run：只讀資料庫與列出物件，印出清單與筆數，不刪除。
 *   - --apply 一定要帶 --expect-objects（dry-run 確認過的筆數），這次算出的筆數不同就不刪。
 *   - 刪除前把清單寫成 CSV（tenantId、conversationId、key），檔案已存在時不覆蓋。物件刪除無法還原，
 *     清單只是紀錄。每個 key 最多刪一次、不重試，失敗的 key 印出來並以非零結束。
 *   - 需要能略過 RLS 的資料庫連線：優先用 MIGRATE_DATABASE_URL，否則 DATABASE_URL。
 *     連線身分不能略過 RLS 時直接失敗，不會因為看不到資料而回報 0 筆。
 *   - 物件儲存：用 @open333crm/core 的 MinioStorageProvider，連線設定與 api 相同（S3_ENDPOINT、S3_ACCESS_KEY、
 *     S3_SECRET_KEY；有 MINIO_ENDPOINT 時優先用 MINIO_*，見 core 的 resolveMinioConfig）。bucket 是 S3_BUCKET，預設 open333crm。
 *
 * 用法（在 repo 根目錄，或把 scripts/ 整個資料夾複製到 API 容器的 /app/scripts/ 後在 /app 執行）：
 *   node scripts/recover-erased-media-orphans.mjs [--tenant <id> ...]
 *   node scripts/recover-erased-media-orphans.mjs --tenant <id> --apply --expect-objects 12 [--out-dir /tmp]
 *
 * 操作手冊：docs/ref/features/tenant/GOVERNANCE.md「回收 #329 前匿名化留下的媒體檔」。
 */
import { createRequire } from 'node:module';
import { closeSync, existsSync, openSync, readFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SQL_PATH = fileURLToPath(new URL('./sql/recover-erased-media-orphans.sql', import.meta.url));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE_BATCH = 500;

const USAGE = `用法：
  node scripts/recover-erased-media-orphans.mjs [--tenant <id> ...]
  node scripts/recover-erased-media-orphans.mjs [--tenant <id> ...] --apply --expect-objects N [--out-dir 目錄]`;

/**
 * @description 解析命令列參數；不合法時丟出 Error（訊息為繁體中文）。
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseArgs(argv) {
  const opts = { tenants: [], apply: false, expectObjects: null, outDir: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const takeValue = () => {
      if (eq > 0) return arg.slice(eq + 1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${name} 需要一個值`);
      i += 1;
      return next;
    };
    switch (name) {
      case '--apply':
        opts.apply = true;
        break;
      case '--tenant': {
        const id = takeValue();
        if (!UUID_RE.test(id)) throw new Error(`--tenant 要是租戶 ID（UUID），收到「${id}」`);
        opts.tenants.push(id.toLowerCase());
        break;
      }
      case '--expect-objects': {
        const raw = takeValue();
        if (!/^\d+$/.test(raw)) throw new Error(`--expect-objects 要是 0 以上的整數，收到「${raw}」`);
        opts.expectObjects = Number(raw);
        break;
      }
      case '--out-dir':
        opts.outDir = resolve(takeValue());
        break;
      default:
        throw new Error(`不認得的參數 ${arg}\n${USAGE}`);
    }
  }
  if (opts.apply && opts.expectObjects === null) {
    throw new Error(`--apply 要帶 --expect-objects（先執行 dry-run 確認要刪的筆數）。物件刪除無法還原。\n${USAGE}`);
  }
  return opts;
}

/** @description 讀出 SQL 檔，以 `-- @名稱` 切成段落 */
export function readSections(path = SQL_PATH) {
  const parts = readFileSync(path, 'utf8').split(/^-- @([a-z-]+)\s*$/m);
  const sections = new Map();
  for (let i = 1; i < parts.length; i += 2) sections.set(parts[i], parts[i + 1].trim());
  return sections;
}

function sectionOf(sections, name) {
  const sql = sections.get(name);
  if (!sql) throw new Error(`recover-erased-media-orphans.sql 缺少 -- @${name} 段落`);
  return sql;
}

/**
 * @description 找出要回收的孤兒檔（只讀資料庫、只列出物件，不刪除）。
 * @param {{ $executeRawUnsafe: Function, $queryRawUnsafe: Function }} db owner 連線或交易（能略過 RLS）
 * @param {{ list(bucket: string, prefix: string): Promise<string[]> }} storage 物件儲存
 * @param {{ tenants: string[], bucket: string, isConversationMediaKey: Function }} opts
 */
export async function collectOrphans(db, storage, opts) {
  const sections = readSections();
  const tenantsParam = opts.tenants.join(',');
  await db.$executeRawUnsafe(sectionOf(sections, 'guard'));
  const conversations = await db.$queryRawUnsafe(sectionOf(sections, 'target-conversations'), tenantsParam);
  const hardDeleteRequests = await db.$queryRawUnsafe(sectionOf(sections, 'hard-delete-requests'), tenantsParam);

  const byTenant = new Map();
  for (const { tenantId, conversationId } of conversations) {
    const t = byTenant.get(tenantId) ?? { tenantId, conversations: 0, listed: 0, skipped: [], candidates: [] };
    byTenant.set(tenantId, t);
    t.conversations += 1;
    const keys = await storage.list(opts.bucket, `${tenantId}/media/${conversationId}/`);
    t.listed += keys.length;
    const conv = new Set([conversationId]);
    for (const key of keys) {
      if (opts.isConversationMediaKey(key, tenantId, conv)) t.candidates.push({ tenantId, conversationId, key });
      else t.skipped.push(key);
    }
  }

  const toDelete = [];
  const tenants = [];
  for (const t of byTenant.values()) {
    const referenced = new Set();
    for (let i = 0; i < t.candidates.length; i += REFERENCE_BATCH) {
      const batch = t.candidates.slice(i, i + REFERENCE_BATCH).map((c) => c.key);
      const rows = await db.$queryRawUnsafe(sectionOf(sections, 'referenced-keys'), t.tenantId, batch);
      for (const row of rows) referenced.add(row.key);
    }
    const orphans = t.candidates.filter((c) => !referenced.has(c.key));
    toDelete.push(...orphans);
    tenants.push({
      tenantId: t.tenantId,
      conversations: t.conversations,
      listed: t.listed,
      referenced: referenced.size,
      skipped: t.skipped,
      toDelete: orphans.length,
    });
  }
  return { tenants, toDelete, hardDeleteRequests, scope: opts.tenants };
}

/**
 * @description 刪除 collectOrphans 找到的物件。筆數與 expectObjects 不同時不刪；刪除前寫出清單。
 * @returns {Promise<{ deleted: number, failed: string[], file: string | null }>}
 */
export async function applyDeletion(storage, report, opts) {
  const total = report.toDelete.length;
  if (opts.expectObjects !== total) {
    throw new Error(`要刪 ${total} 個物件，與預期的 ${opts.expectObjects} 個不一致，這次不刪除。請重新執行 dry-run 確認。`);
  }
  if (total === 0) return { deleted: 0, failed: [], file: null };

  const stamp = opts.fileStamp ?? new Date().toISOString().replace(/[-:.]/g, '');
  const file = resolve(opts.outDir, `media-orphans-${stamp}.csv`);
  const fd = openSync(file, 'wx');
  try {
    writeSync(fd, 'tenantId,conversationId,key\n');
    for (const o of report.toDelete) writeSync(fd, `${o.tenantId},${o.conversationId},${o.key}\n`);
  } finally {
    closeSync(fd);
  }

  const failed = [];
  for (const { key } of report.toDelete) {
    try {
      await storage.delete(opts.bucket, key);
    } catch (err) {
      failed.push(key);
      opts.log?.(`刪除失敗 ${key}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { deleted: total - failed.length, failed, file };
}

function printReport(report, log) {
  log(`範圍：${report.scope.length ? report.scope.join(', ') : '所有租戶'}`);
  log(`bucket：${report.bucket}\n`);
  if (report.tenants.length === 0) log('沒有已完成匿名化、仍有對話的聯絡人。');
  for (const t of report.tenants) {
    log(`[${t.tenantId}] 對話 ${t.conversations} 個，列出物件 ${t.listed} 個`);
    log(`  仍被訊息引用（保留）：${t.referenced} 個`);
    log(`  格式不符（略過）：${t.skipped.length} 個${t.skipped.length ? `：${t.skipped.join('、')}` : ''}`);
    log(`  要刪：${t.toDelete} 個`);
  }
  const hard = report.hardDeleteRequests.reduce((n, r) => n + r.count, 0);
  log(`\n已完成的硬刪除請求 ${hard} 筆：對話已刪除，找不到媒體目錄，不處理`);
  log(`\n要刪的物件（共 ${report.toDelete.length} 個）：`);
  if (report.toDelete.length === 0) log('  無');
  for (const o of report.toDelete) log(`  ${o.key}`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  // 套件裝在 apps/api 底下（repo 與 API 容器都有）；根目錄沒有這些相依
  const apiPackageJson = new URL('../apps/api/package.json', import.meta.url);
  if (!existsSync(apiPackageJson)) {
    console.error('找不到 apps/api/package.json：請把腳本放在 repo（或 API 容器 /app）的 scripts/ 底下執行');
    process.exit(1);
  }
  const requireFromApi = createRequire(apiPackageJson);
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('請設定 MIGRATE_DATABASE_URL 或 DATABASE_URL');
    process.exit(1);
  }
  const { PrismaClient } = requireFromApi('@prisma/client');
  const core = await import(pathToFileURL(requireFromApi.resolve('@open333crm/core')).href);
  const prisma = new PrismaClient({ datasourceUrl: url });
  const storage = new core.MinioStorageProvider();
  const bucket = process.env.S3_BUCKET || 'open333crm';
  const log = (line) => console.log(line);

  try {
    const report = await collectOrphans(prisma, storage, {
      tenants: opts.tenants,
      bucket,
      isConversationMediaKey: core.isConversationMediaKey,
    });
    printReport({ ...report, bucket }, log);
    if (!opts.apply) {
      log('\n[dry-run] 沒有刪除。確認清單後加上 --apply 執行，並帶');
      log(`  --expect-objects ${report.toDelete.length}`);
      return;
    }
    const applied = await applyDeletion(storage, report, { ...opts, bucket, log });
    log(`\n已刪除 ${applied.deleted} 個物件。`);
    if (applied.file) log(`刪除前寫出的清單：${applied.file}`);
    if (applied.failed.length > 0) {
      console.error(`刪除失敗 ${applied.failed.length} 個（不重試）：\n  ${applied.failed.join('\n  ')}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\n失敗：${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
  // @open333crm/core 的 logger 等可能留下 handle，結束時直接離開
  process.exit(process.exitCode ?? 0);
}
