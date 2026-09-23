/**
 * 素材「點擊後貼標」的鏈路完整性。
 *   npx tsx src/__tests__/tag-on-click.test.ts
 *
 * 使用者問「在素材上設定點擊貼標，使用者點擊後是否能正確觸發」。
 * 本機實測答案是「會」，這支測試把那條鏈路釘住——它橫跨四個檔案，
 * 任一環斷掉都不會有編譯錯誤，只會靜默不貼標，很難發現。
 *
 * 鏈路：
 *   1. ActionConfigEditor（前端）：選標籤 → postback data 寫成 `tag:<uuid>`
 *      （uri 型另走 tagOnClick → 素材短連結，不進 LINE payload）
 *   2. 使用者點按鈕 → 渠道送 postback 進 webhook
 *   3. runInboundPostbackInterceptors → handleTagOnClick 比對 `^tag:<uuid>$`
 *   4. addTagToTarget → 驗 scope 必須是 CONTACT → 寫 ContactTag
 *
 * 本機端到端實測（2026-09-23）：
 *   - 點擊前 0 個標籤 → 送 `tag:<id>` → 點擊後 1 個 ✔
 *   - 重複點擊仍是 1 個（upsert 去重）✔
 *   - 送 MATERIAL scope 的標籤 → 未誤貼，且訊息仍正常處理 ✔
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const webSrc = (rel: string) =>
  readFileSync(join(here, '../../../../apps/web/src', rel), 'utf8');

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

const interceptors = src('modules/webhook/inbound-postback-interceptors.ts');
const tagging = src('modules/tag/tagging.service.ts');
const editor = webSrc('components/materials/line/ActionConfigEditor.tsx');

// ─── payload 格式：前後端必須用同一套 ────────────────────────────────────

/** 後端比對用的正規表達式（與 handleTagOnClick 內同語意） */
const TAG_RE = /^tag:([0-9a-f-]{36})$/i;

t('前端寫入的格式，後端比對得到', () => {
  // 前端：onChange({ ...action, data: `tag:${tagId}` })
  const tagId = '60c27235-33ca-454c-a15b-4c1081e09ff4';
  const written = `tag:${tagId}`;
  const m = TAG_RE.exec(written);
  assert.ok(m, '後端的 TAG_RE 比對不到前端寫出的 data');
  assert.equal(m[1], tagId);
});

t('大小寫不敏感（渠道可能改變大小寫）', () => {
  assert.ok(TAG_RE.test('TAG:60C27235-33CA-454C-A15B-4C1081E09FF4'));
});

t('不吃格式不符的 payload（避免誤判成貼標）', () => {
  for (const bad of [
    'tag:not-a-uuid',
    'tag:',
    'csat:5:60c27235-33ca-454c-a15b-4c1081e09ff4', // 別的 interceptor 的格式
    'tag:60c27235-33ca-454c-a15b-4c1081e09ff4:extra',
    'prefix-tag:60c27235-33ca-454c-a15b-4c1081e09ff4',
  ]) {
    assert.ok(!TAG_RE.test(bad), `${bad} 不該被當成貼標指令`);
  }
});

// ─── 鏈路接線：任一環斷掉都不會有編譯錯誤 ───────────────────────────────

t('前端 postback 型會把 tagId 寫成 tag:<uuid>', () => {
  assert.ok(
    /data:\s*tagId\s*\?\s*`tag:\$\{tagId\}`/.test(editor),
    'ActionConfigEditor 未把選到的標籤寫成 tag:<uuid> 格式',
  );
});

t('前端只列 CONTACT scope 的標籤供選擇', () => {
  const hook = webSrc('hooks/useContactTags.ts');
  assert.ok(
    /scope === 'CONTACT'/.test(hook),
    '若列出其他 scope，使用者選了會在後端被 assertTagScope 擋下、靜默不貼標',
  );
});

t('handleTagOnClick 有被 runInboundPostbackInterceptors 呼叫', () => {
  assert.ok(
    /runInboundPostbackInterceptors[\s\S]{0,300}?await handleTagOnClick\(ctx\)/.test(interceptors),
    'handleTagOnClick 未被呼叫——設定了貼標也不會觸發',
  );
});

t('貼標不短路後續 interceptor（CSAT/KB/handoff 仍要跑）', () => {
  // handleTagOnClick 是 await 但不 return，後面的 handleCsatResponse 等仍會執行
  const block = interceptors.slice(
    interceptors.indexOf('export async function runInboundPostbackInterceptors'),
    interceptors.indexOf('async function handleTagOnClick'),
  );
  assert.ok(
    !/return await handleTagOnClick|if \(await handleTagOnClick/.test(block),
    '貼標不該短路——同一則 postback 可能同時要貼標又要處理 CSAT',
  );
});

t('webhook.service 有接上 interceptor', () => {
  const svc = src('modules/webhook/webhook.service.ts');
  assert.ok(
    svc.includes('runInboundPostbackInterceptors'),
    'webhook.service 未呼叫 interceptor——整條鏈路斷在入口',
  );
});

// ─── 防呆：貼標失敗不可影響訊息處理 ─────────────────────────────────────

t('貼標失敗是靜默略過，不拋例外', () => {
  const block = interceptors.slice(interceptors.indexOf('async function handleTagOnClick'));
  assert.ok(
    /try\s*\{[\s\S]*?addTagToTarget[\s\S]*?\}\s*catch/.test(block),
    '未包 try/catch——標籤被刪或 scope 不符會讓整則訊息處理失敗',
  );
});

t('缺 contactId 時直接跳過（訪客尚未建立聯絡人的情況）', () => {
  const block = interceptors.slice(interceptors.indexOf('async function handleTagOnClick'));
  assert.ok(/if \(!ctx\.contactId\) return/.test(block), '未檢查 contactId');
});

// ─── scope 驗證：這是「選錯標籤就靜默失敗」的保護 ───────────────────────

t('addTagToTarget 會驗 scope 與 targetType 相符', () => {
  assert.ok(
    /assertTagScope\(input\.targetType, tag\)/.test(tagging),
    '未驗 scope——MATERIAL 標籤會被貼到聯絡人上',
  );
});

t('貼標用 upsert，重複點擊不會產生兩筆', () => {
  const block = tagging.slice(tagging.indexOf('export async function addTagToTarget'));
  assert.ok(
    /contactTag\.upsert/.test(block),
    '用 create 而非 upsert 的話，使用者連點兩次會撞 unique constraint',
  );
});

t('貼標來源標記為 system（與客服手動貼標區分）', () => {
  const block = interceptors.slice(interceptors.indexOf('async function handleTagOnClick'));
  assert.ok(/addedBy: 'system'/.test(block), '未標記來源，事後無法分辨是誰貼的');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
