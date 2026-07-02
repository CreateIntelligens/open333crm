/**
 * 階段 02 — Prefilter 規則粗篩（省 LLM 成本）
 *
 * 只留「有知識價值」的通話進 03-extract。判定條件（任一）：
 *   - 命中服務/交易或故障排除關鍵詞
 *   - 或偵測到型號
 * 且必須有實質問答（turn 數 ≥ MIN_TURNS，濾掉純寒暄/秒掛）。
 *
 * 命中原因寫進 reasons（含缺口分類），供 05-report 映射缺料。
 * 產出 data/02-candidates.jsonl（只留 hasKnowledge:true）。
 *
 * 執行：pnpm --filter @open333crm/kb-ingest prefilter
 */
import { FILES } from './lib/config.js';
import { readJsonl, writeJsonl } from './lib/jsonl.js';
import { matchGapCategories } from './lib/keywords.js';
import { turnsToText } from './lib/transcript.js';
import type { ScannedCall, CandidateCall } from './lib/types.js';

/** 少於此 turn 數視為無實質問答（純寒暄、秒掛、報錯號）。 */
const MIN_TURNS = 6;

function main(): void {
  const scanned = readJsonl<ScannedCall>(FILES.scanned);
  console.log(`[02-prefilter] 讀入 ${scanned.length} 通`);

  const candidates: CandidateCall[] = [];
  let empty = 0;
  let tooShort = 0;
  let noSignal = 0;
  const categoryCount = new Map<string, number>();

  for (const call of scanned) {
    if (call.empty) {
      empty++;
      continue;
    }
    if (call.turns.length < MIN_TURNS) {
      tooShort++;
      continue;
    }

    const text = turnsToText(call.turns);
    const gapCats = matchGapCategories(text);
    const reasons: string[] = [];
    for (const c of gapCats) reasons.push(`keyword:${c}`);
    if (call.models.length > 0) reasons.push(`model:${call.models.join(',')}`);

    const hasKnowledge = reasons.length > 0;
    if (!hasKnowledge) {
      noSignal++;
      continue;
    }

    for (const c of gapCats) categoryCount.set(c, (categoryCount.get(c) ?? 0) + 1);
    candidates.push({ ...call, hasKnowledge: true, reasons });
  }

  writeJsonl(FILES.candidates, candidates);

  console.log('\n───── 02-prefilter 統計 ─────');
  console.log(`空檔略過：${empty}`);
  console.log(`turn 過少略過（<${MIN_TURNS}）：${tooShort}`);
  console.log(`無服務/型號訊號略過：${noSignal}`);
  console.log(`保留候選：${candidates.length}（占有內容通話 ${((candidates.length / (scanned.length - empty)) * 100).toFixed(1)}%）`);
  console.log(`\n候選命中的缺口分類分布：`);
  for (const [c, n] of [...categoryCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(10)} ${n}`);
  }
  console.log(`\n輸出：${FILES.candidates}`);
}

main();
