/**
 * CM-178：知識庫約束一律由 llm.service 組裝，provider 不得自行拼接。
 *
 * 這組斷言把「租戶自訂 prompt 必須原封不動保留」與「provider 層不得出現
 * 硬編碼提示詞」釘住，避免日後新增 provider 時又各抄一份。
 *
 * 註：llm.service.ts 的 import 鏈會拉起 Prisma／event-bus／Redis，直接 import
 * 會在測試環境卡住連線，故這裡以原始碼靜態掃描驗證，不載入模組。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const aiDir = join(here, '..', 'modules', 'ai');
const providersDir = join(aiDir, 'providers');
const llmSrc = readFileSync(join(aiDir, 'llm.service.ts'), 'utf8');

// ---------------------------------------------------------------------------
// 1. buildSystemPrompt 的行為（複製實作邏輯驗證，不 import 服務模組）
// ---------------------------------------------------------------------------
const DEFAULT_KB_GROUNDING_PROMPT =
  llmSrc.match(/export const DEFAULT_KB_GROUNDING_PROMPT =\s*([\s\S]*?);\n/)?.[1] ?? '';
assert.ok(DEFAULT_KB_GROUNDING_PROMPT.includes('{{KB_CONTEXT}}'), '預設模板必須含 {{KB_CONTEXT}} 佔位符');

function buildSystemPrompt(base: string, kbContext: string, template: string): string {
  if (!kbContext) return base;
  const grounded = template.replace(/\{\{KB_CONTEXT\}\}/g, () => kbContext);
  return `${base}\n\n${grounded}`;
}

// 無知識庫時原樣返回
assert.equal(buildSystemPrompt('BASE', '', 'IGNORED {{KB_CONTEXT}}'), 'BASE');

// 有知識庫時：租戶 prompt 必須完整保留在最前，約束接在其後
const withKb = buildSystemPrompt('租戶自訂的提示詞', 'KB內容', '約束：{{KB_CONTEXT}}');
assert.ok(withKb.startsWith('租戶自訂的提示詞'), '租戶 prompt 必須原封不動保留在開頭');
assert.ok(withKb.includes('KB內容'), '知識庫內容必須被帶入');
assert.ok(!withKb.includes('{{KB_CONTEXT}}'), '佔位符必須被取代');

// 自訂模板可完全覆寫預設約束（租戶客製的關鍵能力）
const custom = buildSystemPrompt('BASE', 'KB', '請參考官網說明：{{KB_CONTEXT}}');
assert.equal(custom, 'BASE\n\n請參考官網說明：KB');
assert.ok(!custom.includes('轉接專人'), '自訂模板時不應殘留預設約束用語');

// 知識庫內容必須原樣代入：`$&`、`` $` `` 等是 String.replace 的替換樣式，
// 若用字串形式代入會竄改內容（價格、程式碼片段常含 `$`）。
for (const raw of ['每月 $& 起', '詳見 $` 官網', '參數 $1 說明', "金額 $' 元"]) {
  const out = buildSystemPrompt('BASE', raw, '知識庫：{{KB_CONTEXT}}');
  assert.equal(out, `BASE\n\n知識庫：${raw}`, `知識庫內容含替換樣式時被竄改：${raw}`);
}

// 模板若含多個佔位符，每一處都要代入
assert.equal(
  buildSystemPrompt('BASE', 'KB', '前：{{KB_CONTEXT}}／後：{{KB_CONTEXT}}'),
  'BASE\n\n前：KB／後：KB',
);

// ---------------------------------------------------------------------------
// 2. llm.service 必須提供組裝函式，且實際用於呼叫 provider
// ---------------------------------------------------------------------------
assert.ok(/export function buildSystemPrompt\(/.test(llmSrc), 'llm.service 必須匯出 buildSystemPrompt');
assert.ok(
  /systemPrompt: buildSystemPrompt\(/.test(llmSrc),
  'provider.generate 必須傳入已組裝的 systemPrompt',
);

// 代入知識庫必須用 replacer function；字串形式會解讀 `$&` 等替換樣式而竄改內容
assert.ok(
  !/\.replace\(\s*(['"`])\{\{KB_CONTEXT\}\}\1\s*,\s*kbContext\s*\)/.test(llmSrc),
  'buildSystemPrompt 不可用字串形式代入 kbContext（`$&` 等會被解讀為替換樣式）',
);
assert.ok(
  /\.replace\(\s*\/\\\{\\\{KB_CONTEXT\\\}\\\}\/g\s*,\s*\(\)\s*=>\s*kbContext\s*\)/.test(llmSrc),
  'buildSystemPrompt 應以 /g 正規表示式搭配 replacer function 代入 kbContext',
);

// ---------------------------------------------------------------------------
// 3. 預設提示詞不得綁定單一客戶品牌或特定產業
// ---------------------------------------------------------------------------
const promptBlocks = [
  'CRM_REPLY_SYSTEM_PROMPT',
  'CLARIFY_SYSTEM_PROMPT',
  'MODEL_GUIDE_SYSTEM_PROMPT',
  'DEFAULT_KB_GROUNDING_PROMPT',
].map((name) => {
  const body = llmSrc.match(new RegExp(`export const ${name} =\\s*([\\s\\S]*?);\\n`))?.[1];
  assert.ok(body, `找不到 ${name} 的定義`);
  return { name, body: body as string };
});

const forbidden = ['Open333', '家電', '冰箱', '洗衣機', '冷氣', '電鍋'];
for (const { name, body } of promptBlocks) {
  for (const word of forbidden) {
    assert.ok(!body.includes(word), `${name} 不應包含客製化字樣「${word}」`);
  }
}

// ---------------------------------------------------------------------------
// 4. provider 層不得再出現硬編碼提示詞或自行取用 kbContext
// ---------------------------------------------------------------------------
for (const file of ['gemini.provider.ts', 'ollama.provider.ts']) {
  const src = readFileSync(join(providersDir, file), 'utf8');
  assert.ok(!src.includes('kbContext'), `${file} 不應再取用 kbContext（約束改由 llm.service 組裝）`);
  assert.ok(!src.includes('知識庫'), `${file} 不應硬編碼提示詞`);
}

// 型別定義不得再提供 kbContext 入口
const types = readFileSync(join(providersDir, 'types.ts'), 'utf8');
assert.ok(
  !/^\s*kbContext\??:/m.test(types),
  'ChatGenerateOptions 不應再有 kbContext 欄位，避免 provider 自行拼接',
);

console.log('llm-system-prompt: all assertions passed');
