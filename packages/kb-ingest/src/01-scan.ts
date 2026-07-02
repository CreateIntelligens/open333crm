/**
 * 階段 01 — Scan（純本機，無 LLM）
 *
 * 遞迴讀大同逐字稿所有 txt：
 *   - 空檔（0 byte）標 empty、併入統計後仍寫入（保留完整計數）
 *   - 解析每句 `[start - end] [role] text`
 *   - 從檔名切 seat / date / time
 *   - 對整通文字跑 detectModels 抽型號主鍵
 * 產出 data/01-scanned.jsonl（一行一通）。
 *
 * 執行：pnpm --filter @open333crm/kb-ingest scan
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TRANSCRIPT_DIR, FILES, ensureDataDir } from './lib/config.js';
import { writeJsonl } from './lib/jsonl.js';
import {
  parseTranscript,
  parseFilename,
  turnsToText,
  detectModelKeys,
} from './lib/transcript.js';
import type { ScannedCall } from './lib/types.js';

/** 遞迴收集所有 .txt 絕對路徑。 */
function collectTxtFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // 跳過 .DS_Store 等
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTxtFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  ensureDataDir();
  console.log(`[01-scan] 掃描逐字稿目錄：${TRANSCRIPT_DIR}`);
  const files = collectTxtFiles(TRANSCRIPT_DIR).sort();
  console.log(`[01-scan] 找到 ${files.length} 個 txt`);

  const rows: ScannedCall[] = [];
  let emptyCount = 0;
  let parsedTurns = 0;

  for (const full of files) {
    const rel = relative(TRANSCRIPT_DIR, full);
    const size = statSync(full).size;
    const { seat, date, time } = parseFilename(full);

    if (size === 0) {
      emptyCount++;
      rows.push({
        file: rel, seat, date, time,
        models: [], turns: [], charCount: 0, empty: true,
      });
      continue;
    }

    const raw = readFileSync(full, 'utf8');
    const turns = parseTranscript(raw);
    parsedTurns += turns.length;
    const fullText = turnsToText(turns);
    const models = detectModelKeys(fullText);

    rows.push({
      file: rel, seat, date, time,
      models,
      turns,
      charCount: fullText.length,
      empty: false,
    });
  }

  writeJsonl(FILES.scanned, rows);

  // ── 統計摘要 ──
  const nonEmpty = rows.filter((r) => !r.empty);
  const withModels = nonEmpty.filter((r) => r.models.length > 0).length;
  const bySeat = new Map<string, number>();
  const byDate = new Map<string, number>();
  const modelFreq = new Map<string, number>();
  for (const r of nonEmpty) {
    bySeat.set(r.seat, (bySeat.get(r.seat) ?? 0) + 1);
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
    for (const k of r.models) modelFreq.set(k, (modelFreq.get(k) ?? 0) + 1);
  }
  const topModels = [...modelFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  console.log('\n───── 01-scan 統計 ─────');
  console.log(`總檔案數：${rows.length}`);
  console.log(`空檔（未接通）：${emptyCount}`);
  console.log(`有內容：${nonEmpty.length}`);
  console.log(`總對話句數：${parsedTurns}`);
  console.log(`有偵測到型號的通話：${withModels}（${((withModels / nonEmpty.length) * 100).toFixed(1)}%）`);
  console.log(`不重複型號主鍵數：${modelFreq.size}`);
  console.log(`座席數：${bySeat.size}，日期數：${byDate.size}`);
  console.log(`\nTop 15 被提到的型號主鍵：`);
  for (const [k, n] of topModels) console.log(`  ${k.padEnd(12)} ${n}`);
  console.log(`\n輸出：${FILES.scanned}`);
}

main();
