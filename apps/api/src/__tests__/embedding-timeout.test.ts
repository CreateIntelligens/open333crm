/**
 * Embedding 冷啟動逾時與重試。
 *   npx tsx src/__tests__/embedding-timeout.test.ts
 *
 * 背景（Wave 6 欄位級測試）：
 * `generateEmbedding` 原本的 fetch 沒有任何 timeout。Ollama 閒置一段時間會把
 * bge-m3 卸載，下一個請求要等模型重載，期間每個請求都卡滿 Caddy 的 60s
 * gateway timeout。
 *
 * UAT 實測樣態：
 *   #1 504(60s) → #2 504(60s) → #3 504(60s) → #4 200(36s) → #5+ 200(~0.5s)
 * 使用者要連按 3~5 次、每次等 60 秒才搜得到東西。
 *
 * 同一份程式碼其實已經知道這個問題——`/bulk-embed`（knowledge.routes.ts）
 * 的註解明載「to avoid Caddy gateway timeouts on cold-start Ollama」並改成
 * 背景執行，但 `/search` 必須回傳結果給使用者，不能沿用背景執行，
 * 所以一直沒處理。本次改為「應用層自己設逾時 + 冷啟動重試」。
 *
 * 這份測試鎖住的是**時間預算的算術**：日後有人調大逾時或重試次數時，
 * 會在這裡被擋下，而不是上線後又變成 504。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void | Promise<void>) {
  const run = () => {
    try {
      const r = fn();
      if (r instanceof Promise) return r.then(
        () => { console.log(`PASS  ${name}`); pass += 1; },
        (err: Error) => { console.error(`FAIL  ${name}\n      ${err.message}`); fail += 1; },
      );
      console.log(`PASS  ${name}`);
      pass += 1;
    } catch (err) {
      console.error(`FAIL  ${name}`);
      console.error(`      ${(err as Error).message}`);
      fail += 1;
    }
    return Promise.resolve();
  };
  queue = queue.then(run);
}

let queue: Promise<void> = Promise.resolve();

// ─── 從原始碼讀出實際設定值（避免測試與實作各寫一份常數而失真）──────────

const code = src('modules/embedding/embedding.service.ts');

function readConst(name: string): number {
  const m = code.match(new RegExp(`const ${name} = ([0-9_]+)`));
  assert.ok(m, `找不到常數 ${name}`);
  return Number((m as RegExpMatchArray)[1].replace(/_/g, ''));
}

const TIMEOUT_MS = readConst('EMBED_TIMEOUT_MS');
const RETRIES = readConst('EMBED_COLD_START_RETRIES');

/** Caddy 的 gateway timeout（UAT 實測 504 就是卡在這） */
const GATEWAY_TIMEOUT_MS = 60_000;
/** 留給 DB 查詢、向量比對與序列化的餘裕 */
const NON_EMBED_BUDGET_MS = 5_000;

// ─── 時間預算：這組算術是整個修復的核心 ──────────────────────────────────

t('單次逾時明顯小於 gateway timeout（才有機會自己收手）', () => {
  assert.ok(
    TIMEOUT_MS < GATEWAY_TIMEOUT_MS,
    `單次逾時 ${TIMEOUT_MS}ms 不該 >= gateway 的 ${GATEWAY_TIMEOUT_MS}ms`,
  );
});

t('最壞總耗時仍在 gateway 預算內（重試不能把自己重試到 504）', () => {
  // 每次重試之間有 1 秒間隔
  const worstCase = TIMEOUT_MS * (RETRIES + 1) + 1_000 * RETRIES;
  const budget = GATEWAY_TIMEOUT_MS - NON_EMBED_BUDGET_MS;
  assert.ok(
    worstCase <= budget,
    `最壞總耗時 ${worstCase}ms 超過預算 ${budget}ms —— ` +
      `重試次數或單次逾時調太大，會退回「被 Caddy 切斷」的原問題`,
  );
});

t('確實有重試（冷啟動的第一次逾時要能被救回來）', () => {
  assert.ok(RETRIES >= 1, '沒有重試的話，冷啟動第一次就直接失敗給使用者');
});

// ─── 重試邏輯的行為（用假的延遲模擬，不打真的 Ollama）────────────────────

/** 模擬一次帶逾時的呼叫 */
async function attemptWithTimeout(delayMs: number, timeoutMs: number): Promise<'ok'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const id = setTimeout(resolve, delayMs);
      controller.signal.addEventListener('abort', () => {
        clearTimeout(id);
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
    return 'ok';
  } finally {
    clearTimeout(timer);
  }
}

/** 複製實作的重試迴圈結構（縮短時間常數以便快速測試） */
async function retryLoop(
  delays: number[],
  timeoutMs: number,
  retries: number,
): Promise<{ outcome: 'ok' | 'timeout'; attempts: number }> {
  let attempts = 0;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    attempts += 1;
    try {
      await attemptWithTimeout(delays[Math.min(i, delays.length - 1)], timeoutMs);
      return { outcome: 'ok', attempts };
    } catch (err) {
      lastErr = err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (!aborted || i === retries) break;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  if (lastErr instanceof Error && lastErr.name === 'AbortError') {
    return { outcome: 'timeout', attempts };
  }
  throw lastErr;
}

t('正常回應時只打一次，不做多餘重試', async () => {
  const r = await retryLoop([20], 200, RETRIES);
  assert.deepStrictEqual(r, { outcome: 'ok', attempts: 1 });
});

t('冷啟動情境：第一次逾時、第二次成功（這正是要修的情境）', async () => {
  const r = await retryLoop([500, 20], 200, RETRIES);
  assert.strictEqual(r.outcome, 'ok', '重試後應該成功');
  assert.strictEqual(r.attempts, 2, '應該剛好用掉 2 次嘗試');
});

t('持續逾時：耗盡重試後回逾時，不會無限等待', async () => {
  const r = await retryLoop([500], 200, RETRIES);
  assert.strictEqual(r.outcome, 'timeout');
  assert.strictEqual(r.attempts, RETRIES + 1, '嘗試次數應為 1 + 重試次數');
});

// ─── 回歸防護 ─────────────────────────────────────────────────────────────

t('generateEmbedding 確實帶了 AbortController 逾時', () => {
  assert.ok(code.includes('AbortController'), 'fetch 未設逾時，冷啟動會卡滿 gateway');
  assert.ok(code.includes('signal: controller.signal'), 'AbortController 未接到 fetch');
});

t('逾時錯誤被轉成可讀訊息（使用者不該看到 AbortError）', () => {
  assert.ok(
    code.includes('向量化服務逾時'),
    '逾時未轉成中文訊息，使用者會看到 AbortError',
  );
  assert.ok(
    code.includes('Embedding 設定'),
    '逾時訊息未指引使用者去哪裡檢查服務狀態',
  );
});

queue.then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
