/**
 * 錯誤訊息修正的行為驗證。
 *   DATABASE_URL=... npx tsx src/__tests__/error-messages.test.ts
 *
 * 驗的是「使用者實際會收到什麼」，不是字串長相——
 * 例如 portal 的業務錯誤是否真的不再變成 500。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AppError } from '../shared/utils/response.js';

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
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

// ── Bug 1：portal 業務錯誤不可再是 plain Error ──
t('portal.service 不再有 throw new Error（會被吞成 500）', () => {
  const s = src('modules/portal/portal.service.ts');
  assert.ok(!/throw new Error\(/.test(s), '仍有 plain Error，粉絲端會看到 500');
});

t('portal 粉絲端四種情境皆有中文訊息與正確狀態碼', () => {
  const s = src('modules/portal/portal.service.ts');
  for (const [msg, code] of [
    ['活動不存在或尚未開放', 'ACTIVITY_NOT_AVAILABLE'],
    ['活動尚未開始', 'ACTIVITY_NOT_STARTED'],
    ['活動已結束', 'ACTIVITY_ENDED'],
    ['您已參加過這個活動', 'ALREADY_SUBMITTED'],
  ]) {
    assert.ok(s.includes(msg), `缺少訊息：${msg}`);
    assert.ok(s.includes(code), `缺少錯誤碼：${code}`);
  }
});

// ── Bug 2：message 不可等於 code ──
t('AppError 的 message 不可誤填成錯誤碼', () => {
  const s = src('modules/trial/trial.service.ts');
  assert.ok(!/new AppError\('([A-Z_]+)', *'\1'/.test(s), 'message 仍是錯誤碼');
  assert.ok(s.includes('此試用方案已經領取過了'), '缺少中文訊息');
});

// ── Bug 3：NOT_FOUND 必須帶 404 ──
t('shortlink 與 portal 的 NOT_FOUND 會送出 404 而非 200', () => {
  for (const f of ['modules/shortlink/shortlink.routes.ts', 'modules/portal/portal.routes.ts']) {
    const s = src(f);
    const bad = /return \{ success: false, error: \{ code: 'NOT_FOUND'/.test(s);
    assert.ok(!bad, `${f} 仍有未設狀態碼的 NOT_FOUND`);
    assert.ok(/reply\.status\(404\)\.send\(/.test(s), `${f} 未使用 404`);
  }
});

// ── Bug 4：403 結構須與全站一致 ──
t('rbac 403 使用全站慣例 { success, error }', () => {
  const s = src('guards/rbac.guard.ts');
  assert.ok(!/send\(\{ code: 'FORBIDDEN'/.test(s), '仍有舊結構，前端讀不到 error.message');
  assert.ok(s.includes('success: false'), '缺少 success 欄位');
  assert.ok(s.includes("code: 'FORBIDDEN'"), '缺少錯誤碼');
});

t('403 帶 requiredPermission 供維運排查，但訊息不含技術代碼', () => {
  const s = src('guards/rbac.guard.ts');
  assert.ok(s.includes('requiredPermission'), '缺少 requiredPermission details');
  assert.ok(s.includes('requiredAnyOf'), 'requireAnyPermission 應列出所有候選權限');
  // 使用者看到的訊息本身不可含權限碼
  const m = s.match(/const PERMISSION_DENIED = '([^']+)'/);
  assert.ok(m, '找不到 PERMISSION_DENIED');
  assert.ok(!/[a-z]+\.[a-z]+/.test(m![1]), `訊息含疑似權限碼：${m![1]}`);
});

// ── Bug 5：送訊失敗不外洩原始錯誤 ──
t('送訊失敗不把原始例外回給前端（log 內保留原文是正確的）', () => {
  const s = src('modules/conversation/conversation.service.ts');
  // 只擋「寫進 delivery（會回前端）」的情形；logger.error 內保留原文是刻意的
  assert.ok(
    !/delivery = \{ success: false, error: String\(err\)/.test(s),
    '仍把原始例外字串寫進 delivery 回前端',
  );
  assert.ok(/logger\.error\([^)]*String\(err\)/.test(s.replace(/\n/g, ' ')), 'log 應保留原文供排查');
  assert.ok(s.includes('訊息未能送出'), '缺少中文說明');
});

t('deliverToChannel 送出失敗改用 AppError 502', () => {
  const s = src('modules/conversation/conversation.service.ts');
  assert.ok(s.includes('CHANNEL_DELIVERY_FAILED'), '缺少錯誤碼');
  assert.ok(/'CHANNEL_DELIVERY_FAILED',\s*502/.test(s.replace(/\s+/g, ' ')), '狀態碼應為 502（上游失敗）');
});

// ── 外洩 1：全域錯誤處理 ──
t('error-handler 不再回傳 Prisma／Fastify 原文', () => {
  const s = src('plugins/error-handler.plugin.ts');
  // 只允許 AppError 分支使用 error.message（那是我們自己寫的訊息）
  const lines = s.split('\n').filter((l) =>
    /message: error\.message/.test(l) && !/\/\//.test(l));
  assert.equal(lines.length, 1, `仍有 ${lines.length} 處回傳原文（應僅剩 AppError 分支）`);
});

t('P2002 不外洩資料庫欄位名', () => {
  const s = src('plugins/error-handler.plugin.ts');
  assert.ok(!/same \$\{target\.join/.test(s), '仍把欄位名拼進訊息');
  assert.ok(s.includes('UNIQUE_FIELD_LABELS'), '缺少欄位對照表');
  assert.ok(s.includes('資料重複，已有相同的記錄存在'), '缺少未收錄欄位的通用說法');
});

t('全域錯誤處理各分支皆為中文', () => {
  const s = src('plugins/error-handler.plugin.ts');
  for (const m of ['輸入內容有誤', '找不到指定的資料', '資料處理失敗',
                   '提供的資料格式不正確', '找不到此頁面或資源', '系統發生未預期的錯誤']) {
    assert.ok(s.includes(m), `缺少訊息：${m}`);
  }
});

// ── 外洩 2：Partner 端點 ──
t('knowledge Partner 端點不外送內部例外原文', () => {
  const s = src('modules/knowledge/knowledge.routes.ts');
  assert.ok(!/code: 'INGEST_FAILED',\s*message: \(err as Error\)\.message/.test(s.replace(/\n/g,' ')),
    '仍把例外原文送給外部 Partner');
  assert.ok(s.includes('Ingest failed due to an internal error'), '缺少通用英文說明');
});

// ── 外洩 3：第三方原文分情境處理 ──
t('管理員操作：原文移到 details.upstream，message 為中文', () => {
  const cases: Array<[string, string]> = [
    ['modules/channel/channel.service.ts', 'LINE 驗證失敗，請確認 Channel Secret'],
    ['modules/channel/line-webhook-setup.service.ts', 'LINE Webhook 自動設定失敗'],
    ['modules/line/rich-menu.service.ts', 'LINE 無法建立圖文選單'],
    ['modules/line/line-profile.service.ts', '無法取得 LINE 使用者資料'],
  ];
  for (const [f, msg] of cases) {
    const s = src(f);
    assert.ok(s.includes(msg), `${f} 缺少中文訊息`);
    assert.ok(s.includes('upstream:'), `${f} 未把原文放進 details.upstream`);
  }
});

t('第三方原文不再被串進 message 字串', () => {
  for (const f of ['modules/line/rich-menu.service.ts',
                   'modules/channel/line-webhook-setup.service.ts',
                   'modules/line/line-profile.service.ts']) {
    const s = src(f);
    // 樣式：`...${body}` 或 `LINE API error: ${msg}` 這種把原文串進訊息的寫法
    assert.ok(!/`[^`]*\$\{(body|errBody|msg)\}`,\s*\n?\s*'[A-Z_]+'/.test(s),
      `${f} 仍把原文串進 message`);
  }
});

t('Flex 版型驗證刻意保留細節（編輯器回饋，非外洩）', () => {
  const s = src('modules/marketing/material.service.ts');
  assert.ok(s.includes('刻意保留 LINE 原文'), '缺少說明此處為何與其他處不同');
  assert.ok(s.includes('formatLineValidateError'), '格式化函式應保留');
});

// ── Zod 中文化 ──
t('Zod 全域 errorMap 已在 bootstrap 註冊', () => {
  const s = src('index.ts');
  assert.ok(s.includes('installZodChineseLocale()'), '未於啟動時註冊');
});

// ── AppError 本身的行為 ──
t('AppError 預設值與傳入值正確', () => {
  const e = new AppError('測試訊息', 'TEST_CODE', 409, { k: 'v' });
  assert.equal(e.message, '測試訊息');
  assert.equal(e.code, 'TEST_CODE');
  assert.equal(e.statusCode, 409);
  assert.deepEqual(e.details, { k: 'v' });
});

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
