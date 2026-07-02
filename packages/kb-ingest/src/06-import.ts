/**
 * 階段 06 — 審核後匯入 KB（一律 DRAFT）
 *
 * 讀人工審核後的 04-articles.reviewed.csv（若不存在，退回讀未審核的
 * 04-articles.csv 並警告），把每列建成一筆 KmArticle。
 *
 * 設計決策：
 *   - 狀態一律 DRAFT（只有 PUBLISHED+embedding 才會被 AI 檢索；DRAFT 讓人工
 *     在系統內二次確認後再上架，避免半成品被客戶端 AI 拿去答）。
 *   - 直接用 PrismaClient 寫入（不拉 apps/api config 鏈）；不在此觸發 embedding
 *     （DRAFT 不會被檢索，上架時再用 API 的 /bulk-embed 補嵌）。
 *   - createdById 用固定系統 UUID（schema 無硬 FK）。
 *
 * 執行：
 *   pnpm --filter @open333crm/kb-ingest import -- --dry-run   # 只驗證 CSV，不寫 DB
 *   pnpm --filter @open333crm/kb-ingest import                # 實際寫入 DRAFT
 */
import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@open333crm/database';
import { FILES, TENANT_ID, ENV } from './lib/config.js';

/** 系統匯入帳號（固定 UUID，僅用於 createdById 標記來源）。 */
const SYSTEM_AGENT_ID = 'a0000000-0000-0000-0000-0000000000cc';

interface ReviewedRow {
  clusterId: string;
  category: string;
  tags: string[];
  volatile: boolean;
  title: string;
  content: string;
  summary: string;
}

/** 極簡 CSV parser（支援引號跳脫、跨行欄位）。 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // 去 BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      if (field !== '' || record.length > 0) {
        record.push(field);
        rows.push(record);
        record = [];
        field = '';
      }
    } else field += c;
  }
  if (field !== '' || record.length > 0) { record.push(field); rows.push(record); }

  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = r[idx] ?? ''));
    return obj;
  });
}

function parseArgs(): { dryRun: boolean } {
  return { dryRun: process.argv.slice(2).includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs();

  let csvPath = FILES.articlesReviewed;
  if (!existsSync(csvPath)) {
    console.warn(
      `[06-import] 找不到審核檔 ${FILES.articlesReviewed}，改用未審核的 ${FILES.articlesCsv}（建議先人工審核）`,
    );
    csvPath = FILES.articlesCsv;
  }
  if (!existsSync(csvPath)) {
    console.error('[06-import] 沒有可匯入的文章 CSV，請先跑 04-cluster。');
    process.exit(1);
  }

  const raw = parseCsv(readFileSync(csvPath, 'utf8'));
  const rows: ReviewedRow[] = raw
    .filter((r) => (r.title ?? '').trim() && (r.content ?? '').trim())
    .map((r) => ({
      clusterId: r.clusterId ?? '',
      category: r.category || '產品諮詢',
      tags: (r.tags ?? '').split('|').map((t) => t.trim()).filter(Boolean),
      volatile: String(r.volatile).toLowerCase() === 'true',
      title: r.title.trim(),
      content: r.content.trim(),
      summary: (r.summary ?? '').trim(),
    }));

  console.log(`[06-import] 待匯入 ${rows.length} 篇（來源：${csvPath}）`);
  console.log(`  volatile（提醒需人工當週確認）：${rows.filter((r) => r.volatile).length}`);

  if (dryRun) {
    console.log('\n[--dry-run] 不寫入 DB。前 5 篇預覽：');
    for (const r of rows.slice(0, 5)) {
      console.log(`  - [${r.category}] ${r.title}（tags: ${r.tags.join(',')}）`);
    }
    console.log('\n驗證通過，移除 --dry-run 即可實際寫入 DRAFT。');
    return;
  }

  if (!ENV.databaseUrl) {
    console.error('[06-import] DATABASE_URL 未設定（root .env）');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let imported = 0;
  let failed = 0;
  try {
    for (const r of rows) {
      try {
        await prisma.kmArticle.create({
          data: {
            tenantId: TENANT_ID,
            createdById: SYSTEM_AGENT_ID,
            title: r.title,
            content: r.content,
            summary: r.summary,
            category: r.category,
            tags: r.tags,
            status: 'DRAFT', // 一律 DRAFT，見檔頭說明
            externalSource: 'kb-ingest:大同逐字稿',
            metadata: { volatile: r.volatile, clusterId: r.clusterId },
          },
        });
        imported++;
      } catch (err) {
        failed++;
        console.warn(`  匯入失敗「${r.title.slice(0, 30)}」：${(err as Error).message}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n───── 06-import 完成 ─────');
  console.log(`匯入 DRAFT：${imported} 篇`);
  console.log(`失敗：${failed} 篇`);
  console.log('提醒：DRAFT 不會被 AI 檢索。人工在系統內審核後，穩定且非 volatile 的文章');
  console.log('再改 PUBLISHED 並用 API 的 /api/v1/knowledge/bulk-embed 補 embedding。');
}

main();
