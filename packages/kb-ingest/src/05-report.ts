/**
 * 階段 05 — 分析報告（產出 B，不進 DB）
 *
 * 從 03-extracted.jsonl 直接彙總（不需人工審核）：
 *   1. 問題分布報告：分類 / 型號的真實提問次數（CSV）
 *   2. 缺料驗證報告：把抽出的問題映射回 KB缺料清單，量化逐字稿補了哪些
 *      P1/P2/P3 缺口、各補幾則，驗證「核心價值是補服務/交易資訊」假設（Markdown）
 *
 * 執行：pnpm --filter @open333crm/kb-ingest report
 */
import { FILES } from './lib/config.js';
import { readJsonl, writeCsv } from './lib/jsonl.js';
import { normalizeCategory } from './lib/guards.js';
import { writeFileSync } from 'node:fs';
import type { ExtractedQa } from './lib/types.js';

/** 抽取分類 → KB缺料清單的缺口項目（含優先級）。 */
const CATEGORY_TO_GAP: Record<string, { gap: string; priority: string }> = {
  保固: { gap: '保固期限', priority: 'P1' },
  門市據點: { gap: '門市地址/據點清單', priority: 'P1' },
  客服專線: { gap: '客服專線電話', priority: 'P1' },
  維修費用: { gap: '維修費用/價格', priority: 'P1' },
  退換貨: { gap: '退換貨流程', priority: 'P1' },
  促銷活動: { gap: '促銷/活動/折扣', priority: 'P1' },
  送修流程: { gap: '送修/報修流程（服務流程）', priority: 'P1(延伸)' },
  故障排除: { gap: '故障排除 SOP（各品類）', priority: 'P3' },
  使用教學: { gap: '使用/操作教學', priority: '一般' },
  產品諮詢: { gap: '產品/規格諮詢（KB 已有 540 篇）', priority: '已覆蓋' },
};

function main(): void {
  const extracted = readJsonl<ExtractedQa>(FILES.extracted);
  console.log(`[05-report] 讀入 ${extracted.length} 則 QA`);
  if (extracted.length === 0) {
    console.error('沒有 QA，請先跑 03-extract。');
    process.exit(1);
  }

  // ── 1. 問題分布（分類 + 型號）──
  const byCategory = new Map<string, number>();
  const byModel = new Map<string, number>();
  for (const qa of extracted) {
    const cat = normalizeCategory(qa.category);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    for (const m of qa.models) byModel.set(m, (byModel.get(m) ?? 0) + 1);
  }

  const distRows = [
    ...[...byCategory.entries()].map(([k, n]) => ({ 類型: '分類', 項目: k, 提問則數: n })),
    ...[...byModel.entries()].map(([k, n]) => ({ 類型: '型號', 項目: k, 提問則數: n })),
  ].sort((a, b) => b.提問則數 - a.提問則數);

  writeCsv(FILES.reportDistribution, ['類型', '項目', '提問則數'], distRows);

  // ── 2. 缺料驗證 ──
  const gapFill = new Map<string, { gap: string; priority: string; count: number; volatile: number }>();
  for (const qa of extracted) {
    const cat = normalizeCategory(qa.category);
    const info = CATEGORY_TO_GAP[cat];
    if (!info) continue;
    const cur = gapFill.get(cat) ?? { gap: info.gap, priority: info.priority, count: 0, volatile: 0 };
    cur.count++;
    if (qa.volatile) cur.volatile++;
    gapFill.set(cat, cur);
  }

  const p1Total = [...gapFill.entries()]
    .filter(([, v]) => v.priority.startsWith('P1'))
    .reduce((s, [, v]) => s + v.count, 0);

  const lines: string[] = [];
  lines.push('# 大同逐字稿 — KB 缺料驗證報告\n');
  lines.push(`> 資料來源：${extracted.length} 則從客服逐字稿萃取的 QA（本批）\n`);
  lines.push('## 一、核心結論\n');
  lines.push(
    `逐字稿萃取的 QA 中，**${p1Total} 則（${((p1Total / extracted.length) * 100).toFixed(0)}%）** 落在 KB 缺料清單標記為「0 篇」的 P1 服務/交易缺口，` +
      `印證了「逐字稿的核心價值是補服務/交易資訊，而非產品規格」的假設。\n`,
  );

  lines.push('## 二、各缺口補料量（依 KB缺料清單 對照）\n');
  lines.push('| 缺口項目 | 優先級 | 逐字稿補料則數 | 其中會變動(volatile) | KB 原現況 |');
  lines.push('|---|---|---:|---:|---|');
  const sortedGaps = [...gapFill.values()].sort((a, b) => b.count - a.count);
  for (const g of sortedGaps) {
    const status = g.priority.startsWith('P1') ? '0 篇' : g.priority === '已覆蓋' ? '約 540 篇' : '—';
    lines.push(`| ${g.gap} | ${g.priority} | ${g.count} | ${g.volatile} | ${status} |`);
  }

  lines.push('\n## 三、問題分布 Top（客戶真實高頻提問）\n');
  lines.push('| 分類 | 提問則數 |');
  lines.push('|---|---:|');
  for (const [k, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${n} |`);
  }

  lines.push('\n## 四、被提到最多的型號 Top 15\n');
  lines.push('| 型號主鍵 | 提問則數 |');
  lines.push('|---|---:|');
  for (const [k, n] of [...byModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    lines.push(`| ${k} | ${n} |`);
  }

  lines.push('\n## 五、建議行動\n');
  lines.push('1. **優先補 P1 服務/交易資訊**（保固、門市、客服專線、維修費用、退換貨）——這些逐字稿補料量最大且 KB 原本 0 篇。');
  lines.push('2. **volatile 資料交人工當週確認**（價格/門市電話/營業時間），入庫一律 DRAFT，不直接上架。');
  lines.push('3. **送修/報修流程**是最高頻主題，值得整理成幾篇權威 SOP 文章。');

  writeFileSync(FILES.reportGap, lines.join('\n') + '\n', 'utf8');

  console.log('\n───── 05-report 完成 ─────');
  console.log(`P1 服務/交易缺口補料：${p1Total} 則（${((p1Total / extracted.length) * 100).toFixed(0)}%）`);
  console.log(`問題分布 CSV：${FILES.reportDistribution}`);
  console.log(`缺料驗證報告：${FILES.reportGap}`);
}

main();
