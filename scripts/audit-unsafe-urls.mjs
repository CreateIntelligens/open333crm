#!/usr/bin/env node
/**
 * 稽核既有資料中的危險網址 scheme。
 *
 * 為什麼需要：Wave 6 的 url-schemes 只擋「新的 create／update」，
 * DB 裡既有的 javascript:／data: 等值仍會被前端渲染或被後端使用
 * （PR Agent review 2026-09-22 指出的第 3 點）。
 *
 * 唯讀，不修改任何資料。部署前跑一次，有命中再決定怎麼清。
 *
 * 用法（需在能解析 @prisma/client 的位置執行）：
 *   cd apps/api && DATABASE_URL=... node --experimental-default-type=module \
 *     ../../scripts/audit-unsafe-urls.mjs
 *
 * 或直接在 UAT 容器內（prisma client 已就位）：
 *   docker exec open333crm-api node /app/scripts/audit-unsafe-urls.mjs
 *
 * 純 SQL 版本（不需 node，最省事）見檔案末尾註解。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 會被前端渲染或後端連線的網址欄位。 */
const TARGETS = [
  { table: 'materials', column: 'previewImageUrl', usage: '前端 <img src> 渲染' },
  { table: 'short_links', column: 'targetUrl', usage: '轉址頁 window.location.replace()' },
  { table: 'tenant_settings', column: 'embeddingBaseUrl', usage: '後端 fetch（向量化）' },
  { table: 'tenant_settings', column: 'chatBaseUrl', usage: '後端 fetch（AI 對話）' },
  { table: 'channels', column: 'webhookUrl', usage: '對外 webhook 位址' },
];

/** 危險 scheme：能在前端執行腳本或讀本機檔案。 */
const UNSAFE_SCHEME_RE = '^(javascript|data|file|vbscript|blob):';

async function main() {
  let total = 0;
  console.log('稽核既有資料的危險網址 scheme（唯讀）\n');

  for (const { table, column, usage } of TARGETS) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, "${column}" AS val FROM "${table}" WHERE "${column}" ~* $1 LIMIT 20`,
        UNSAFE_SCHEME_RE,
      );
      const n = rows.length;
      total += n;
      const mark = n > 0 ? '⚠️ ' : '   ';
      console.log(`${mark}${table}.${column}  ${n} 筆  （${usage}）`);
      for (const r of rows) {
        // 只印前 60 字，避免把完整 payload 貼進 log
        console.log(`     id=${r.id}  ${String(r.val).slice(0, 60)}`);
      }
    } catch (err) {
      console.log(`   ${table}.${column}  查詢失敗：${err.message.split('\n')[0]}`);
    }
  }

  console.log(`\n合計 ${total} 筆`);
  if (total > 0) {
    console.log('\n建議：');
    console.log('  1. 逐筆確認是誤植還是攻擊痕跡（看 createdAt 與來源租戶）');
    console.log('  2. 前端渲染類（previewImageUrl／targetUrl）優先清，那是 XSS 面');
    console.log('  3. 清除前先備份該欄位值');
  }
  await prisma.$disconnect();
  process.exit(total > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('稽核失敗：', e.message);
  await prisma.$disconnect();
  process.exit(2);
});

/*
 * ── 純 SQL 版本 ──────────────────────────────────────────────
 * 不想處理 node 模組解析時，直接對 DB 跑這段即可（同樣唯讀）：
 *
 * SELECT 'materials.previewImageUrl' AS field, id, "previewImageUrl" AS val
 *   FROM materials WHERE "previewImageUrl" ~* '^(javascript|data|file|vbscript|blob):'
 * UNION ALL
 * SELECT 'short_links.targetUrl', id, "targetUrl"
 *   FROM short_links WHERE "targetUrl" ~* '^(javascript|data|file|vbscript|blob):'
 * UNION ALL
 * SELECT 'channels.webhookUrl', id, "webhookUrl"
 *   FROM channels WHERE "webhookUrl" ~* '^(javascript|data|file|vbscript|blob):'
 * UNION ALL
 * SELECT 'tenant_settings.embeddingBaseUrl', id, "embeddingBaseUrl"
 *   FROM tenant_settings WHERE "embeddingBaseUrl" ~* '^(javascript|data|file|vbscript|blob):'
 * UNION ALL
 * SELECT 'tenant_settings.chatBaseUrl', id, "chatBaseUrl"
 *   FROM tenant_settings WHERE "chatBaseUrl" ~* '^(javascript|data|file|vbscript|blob):';
 *
 * 2026-09-22 於本機 dev DB 執行：全部 0 筆。UAT 尚未執行。
 */
