/**
 * 階段 03 — LLM 抽取 QA（最貴一步，Gemini flash-lite）
 *
 * 對每個候選整通丟 Gemini，抽出可入庫 QA。三層防幻覺：
 *   1. prompt 明確約束（去 PII、型號只能用清單、寧缺勿造）
 *   2. grounding：userMessage 末端附「本通偵測到型號」
 *   3. 程式端二次校驗：hallucinatedModels / looksVolatile / looksPii → 強制標記
 * confidence 過低或 JSON 解析失敗 → 丟 03-rejected.jsonl。
 *
 * 斷點續跑：每通完成即 append 到 03-extracted.jsonl 並記進度，重跑跳過已完成。
 *
 * 執行：
 *   pnpm --filter @open333crm/kb-ingest extract            # 全量
 *   pnpm --filter @open333crm/kb-ingest extract -- --limit 100   # 只跑前 100 通（品質門）
 *   pnpm --filter @open333crm/kb-ingest extract -- --reset       # 清空重跑
 */
import { existsSync, rmSync } from 'node:fs';
import { FILES, ENV } from './lib/config.js';
import {
  readJsonl,
  appendJsonl,
  readProgress,
  appendProgress,
} from './lib/jsonl.js';
import { geminiGenerate, parseJsonArray, withRetry } from './lib/llm.js';
import { turnsToText } from './lib/transcript.js';
import { EXTRACT_SYSTEM_PROMPT } from './lib/prompts.js';
import {
  hallucinatedModels,
  looksVolatile,
  looksPii,
} from './lib/guards.js';
import type { CandidateCall, ExtractedQa } from './lib/types.js';

const CONCURRENCY = 4;
const MIN_CONFIDENCE = 0.4;

interface RawQa {
  question?: string;
  answer?: string;
  category?: string;
  models?: string[];
  volatile?: boolean;
  needsReview?: boolean;
  confidence?: number;
}

function parseArgs(): { limit?: number; reset: boolean } {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? parseInt(args[li + 1], 10) : undefined;
  return { limit, reset };
}

/** 處理一通：呼叫 Gemini + 二次校驗，回傳有效 QA 陣列（可能空）。 */
async function extractOne(call: CandidateCall): Promise<ExtractedQa[]> {
  const transcript = turnsToText(call.turns);
  const modelHint =
    call.models.length > 0
      ? `\n\n本通偵測到型號：${call.models.join(', ')}`
      : `\n\n本通未偵測到任何型號（answer 不可出現具體型號）。`;

  const raw = await withRetry(() =>
    geminiGenerate({
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      userMessage: `以下是一通客服電話逐字稿：\n\n${transcript}${modelHint}`,
      temperature: 0.2,
      maxTokens: 2048,
    }),
  );

  const parsed = parseJsonArray<RawQa>(raw);
  if (!parsed) throw new Error('JSON_PARSE_FAIL');

  const out: ExtractedQa[] = [];
  for (const q of parsed) {
    if (!q.question || !q.answer) continue;
    const answer = String(q.answer);

    // ── 二次校驗（結構性防幻覺）──
    const halluc = hallucinatedModels(answer, call.models);
    const volatile = Boolean(q.volatile) || looksVolatile(answer);
    const needsReview =
      Boolean(q.needsReview) || halluc.length > 0 || looksPii(answer);

    out.push({
      sourceFile: call.file,
      question: String(q.question),
      answer,
      category: q.category || '產品諮詢',
      models: Array.isArray(q.models) ? q.models : [],
      volatile,
      needsReview,
      confidence: typeof q.confidence === 'number' ? q.confidence : 0.5,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const { limit, reset } = parseArgs();

  if (reset) {
    for (const f of [FILES.extracted, FILES.rejected, FILES.extractProgress]) {
      if (existsSync(f)) rmSync(f);
    }
    console.log('[03-extract] 已清空既有產出（--reset）');
  }

  if (!ENV.geminiApiKey) {
    console.error('[03-extract] 錯誤：GEMINI_API_KEY 未設定（root .env）');
    process.exit(1);
  }

  let candidates = readJsonl<CandidateCall>(FILES.candidates);
  if (limit) candidates = candidates.slice(0, limit);

  const done = readProgress(FILES.extractProgress);
  const todo = candidates.filter((c) => !done.has(c.file));
  console.log(
    `[03-extract] 候選 ${candidates.length} 通，已完成 ${done.size}，本次待處理 ${todo.length}（模型 ${ENV.geminiModel}，併發 ${CONCURRENCY}）`,
  );

  let qaCount = 0;
  let rejectCount = 0;
  let processed = 0;

  // 簡單併發池
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (call) => {
        try {
          const qas = await extractOne(call);
          const kept: ExtractedQa[] = [];
          for (const qa of qas) {
            if (qa.confidence < MIN_CONFIDENCE) {
              appendJsonl(FILES.rejected, { ...qa, reason: 'low_confidence' });
              rejectCount++;
            } else {
              appendJsonl(FILES.extracted, qa);
              kept.push(qa);
            }
          }
          qaCount += kept.length;
        } catch (err) {
          appendJsonl(FILES.rejected, {
            sourceFile: call.file,
            reason: (err as Error).message,
          });
          rejectCount++;
        } finally {
          appendProgress(FILES.extractProgress, call.file);
          processed++;
        }
      }),
    );
    if (processed % 20 === 0 || i + CONCURRENCY >= todo.length) {
      console.log(
        `  進度 ${processed}/${todo.length}｜已抽 QA ${qaCount}｜rejected ${rejectCount}`,
      );
    }
  }

  console.log('\n───── 03-extract 完成 ─────');
  console.log(`本次處理：${processed} 通`);
  console.log(`抽出 QA：${qaCount}`);
  console.log(`rejected：${rejectCount}`);
  console.log(`輸出：${FILES.extracted}`);
}

main();
