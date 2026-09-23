/**
 * 關鍵字命中時 AI 不應再回話。
 *   npx tsx src/__tests__/keyword-suppresses-ai.test.ts
 *
 * 背景（2026-09-23）：使用者在 LINE 送出命中關鍵字的訊息後，
 * 會先收到一段 AI 回覆、再收到關鍵字素材——一次兩則。
 * 使用者指出「關鍵字有命中則 AI 不會再回話」才是預期行為。
 *
 * 根因是遺漏而非設計：kb-autoreply 早就有讓步判斷
 * （attemptKbAutoReply 的第 1.5 步會 hasMatchingKeywordRule 後早退），
 * 但 agent（agentic LLM）那條路沒有做同樣的檢查。
 *
 * ⚠️ 兩條路都要擋：agent 擋掉之後會走 `if (!agentHandled)` 的 KB 後備，
 * 若 KB 那邊沒擋就只是把「AI 回一則」換成「KB 回一則」，問題沒解。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(err as Error).message}`);
    fail += 1;
  }
}

// ─── 比對語意（與 hasMatchingKeywordRule 同邏輯）─────────────────────────

type Rule = { keywords: string[]; matchMode?: 'any' | 'all' };

function matches(text: string, rules: Rule[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const r of rules) {
    if (r.keywords.length === 0) continue;
    const hit =
      r.matchMode === 'all'
        ? r.keywords.every((k) => lower.includes(k.toLowerCase()))
        : r.keywords.some((k) => lower.includes(k.toLowerCase()));
    if (hit) return true;
  }
  return false;
}

// UAT 上的實際規則（2026-09-23）
const UAT_RULES: Rule[] = [
  { keywords: ['觀看更多', '影片'] }, // 規則名稱叫「了解產品」
  { keywords: ['Hi', '你好'] },
];

t('命中關鍵字的訊息會讓 AI 讓步', () => {
  for (const text of ['影片', '我想看影片', '觀看更多', 'hi', '你好']) {
    assert.strictEqual(matches(text, UAT_RULES), true, `「${text}」應命中`);
  }
});

t('沒命中的訊息 AI 照常回覆', () => {
  // 這正是使用者實測時送的字：「了解產品」是規則**名稱**不是關鍵字
  for (const text of ['了解產品', '你們公司在哪', '']) {
    assert.strictEqual(matches(text, UAT_RULES), false, `「${text}」不應命中`);
  }
});

t('大小寫不影響比對（Hi / hi / HI）', () => {
  for (const text of ['Hi', 'hi', 'HI', 'say Hi to me']) {
    assert.strictEqual(matches(text, UAT_RULES), true, `「${text}」應命中`);
  }
});

t('match_mode=all 需全部關鍵字都出現', () => {
  const all: Rule[] = [{ keywords: ['退貨', '訂單'], matchMode: 'all' }];
  assert.strictEqual(matches('我要退貨', all), false, '只有一個關鍵字不該命中');
  assert.strictEqual(matches('訂單要退貨', all), true, '兩個都在才命中');
});

// ─── 回歸防護：兩條路都要擋 ──────────────────────────────────────────────

t('agent 路徑：關鍵字命中時略過 AI 回覆', () => {
  const code = src('modules/automation/automation.worker.ts');
  assert.ok(
    /const keywordWillHandle = await hasMatchingKeywordRule\(/.test(code),
    'agent 路徑未做關鍵字讓步判斷——使用者會一次收到 AI 回覆＋關鍵字素材兩則',
  );
  assert.ok(
    /if \(!keywordWillHandle && isAgentEnabled\(\)/.test(code),
    '讓步判斷沒有實際套用在 runAgentReply 的條件上',
  );
});

t('KB 路徑：原本就有的讓步判斷不可被移除', () => {
  // agent 被擋掉後會走 `if (!agentHandled)` 的 KB 後備；
  // 這裡若沒擋，等於把「AI 回一則」換成「KB 回一則」，問題沒解。
  const code = src('modules/ai/kb-autoreply.service.ts');
  assert.ok(
    /if \(await hasMatchingKeywordRule\(prisma, tenantId, messageText\)\) \{/.test(code),
    'KB 的關鍵字讓步判斷不見了',
  );
});

t('讓步判斷要在 runAgentReply 之前（擋在呼叫前才有意義）', () => {
  const code = src('modules/automation/automation.worker.ts');
  const guardAt = code.indexOf('const keywordWillHandle');
  const callAt = code.indexOf('await runAgentReply(');
  assert.ok(guardAt > 0 && callAt > 0, '找不到判斷或呼叫');
  assert.ok(
    guardAt < callAt,
    '讓步判斷寫在 runAgentReply 之後——AI 已經回過了，擋不住',
  );
});

t('比對出錯時不應連帶擋掉 AI（寧可多回一則，不要完全沒回應）', () => {
  // hasMatchingKeywordRule 內部若拋錯會往外傳，外層 try/catch 會接住，
  // 此時整段 bot 回覆都不會執行——確認外層確實有 try/catch 兜底。
  const code = src('modules/automation/automation.worker.ts');
  const idx = code.indexOf('const keywordWillHandle');
  const after = code.slice(idx);
  assert.ok(
    /catch \(err\) \{[\s\S]{0,200}Error handling message\.received/.test(after),
    'message.received 外層缺少 try/catch，比對出錯會讓整條鏈中斷',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
