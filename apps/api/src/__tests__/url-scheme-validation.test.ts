/**
 * 網址 scheme 白名單驗證。
 *   npx tsx src/__tests__/url-scheme-validation.test.ts
 *
 * 背景（Wave 6 欄位級測試）：
 * `z.string().url()` 底層是 `new URL()`，只檢查「可不可以解析」，
 * 完全不限制 protocol —— javascript: / data: / file: / ftp: 全部通過。
 *
 * 風險分兩類：
 * 1. 後端會主動連線的位址（SSRF 面）
 *    - Embedding baseUrl：後端 fetch 它做健康檢查與向量化
 *    - 渠道 webhookBaseUrl：會被串成對外 webhook 位址
 * 2. 前端會渲染成連結或圖片來源的網址（XSS 面）
 *    - 短連結 targetUrl：轉址頁丟進 window.location.replace()
 *    - 素材 previewImageUrl：當 <img src>
 *    - Rich Menu uri：publishRichMenu 原樣轉送給 LINE
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { httpUrlSchema, lineUriSchema, isSafeHttpUrl } from '../shared/utils/url-schemes.js';

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

/** Wave 6 實測可通過舊驗證的危險值 */
const DANGEROUS = [
  'javascript:alert(1)',
  'javascript:void(0)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'ftp:/x',
  'ftp://example.com/x',
];

// ─── 先確認「為什麼這是 bug」的前提 ────────────────────────────────────────

t('前提：new URL() 對 javascript: / data: / file: 都能解析成功', () => {
  for (const bad of DANGEROUS) {
    let ok = true;
    try {
      new URL(bad);
    } catch {
      ok = false;
    }
    assert.strictEqual(ok, true, `new URL(${bad}) 應可解析——這正是 .url() 擋不住的原因`);
  }
});

// ─── httpUrlSchema：後端會連線 / 前端會渲染的網址 ─────────────────────────

t('httpUrlSchema 擋下所有危險 scheme', () => {
  for (const bad of DANGEROUS) {
    assert.strictEqual(httpUrlSchema.safeParse(bad).success, false, `未擋下 ${bad}`);
  }
});

t('httpUrlSchema 接受正常的 http(s) 網址', () => {
  for (const good of [
    'https://example.com',
    'http://example.com/path?q=1',
    'https://uat.open333crm.create360.ai/api/v1',
  ]) {
    assert.strictEqual(httpUrlSchema.safeParse(good).success, true, `誤殺 ${good}`);
  }
});

t('httpUrlSchema 擋下不是網址的字串', () => {
  for (const bad of ['notaurl', 'example.com', '', '   ']) {
    assert.strictEqual(httpUrlSchema.safeParse(bad).success, false, `未擋下 ${JSON.stringify(bad)}`);
  }
});

t('httpUrlSchema 會 trim 前後空白', () => {
  const r = httpUrlSchema.safeParse('  https://example.com  ');
  assert.strictEqual(r.success, true);
  if (r.success) assert.strictEqual(r.data, 'https://example.com');
});

t('大小寫變形的 javascript: 也被擋下', () => {
  for (const bad of ['JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', 'jAvAsCrIpT:alert(1)']) {
    assert.strictEqual(httpUrlSchema.safeParse(bad).success, false, `未擋下 ${bad}`);
  }
});

// ─── lineUriSchema：LINE action 專用（額外允許 line: / tel:） ──────────────

t('lineUriSchema 允許 LINE 官方認可的四種 scheme', () => {
  for (const good of [
    'https://example.com',
    'http://example.com',
    'line://ti/p/@abc',
    'tel:0912345678',
  ]) {
    assert.strictEqual(lineUriSchema.safeParse(good).success, true, `誤殺 ${good}`);
  }
});

t('lineUriSchema 擋下 javascript: 與 data:', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
    assert.strictEqual(lineUriSchema.safeParse(bad).success, false, `未擋下 ${bad}`);
  }
});

// ─── isSafeHttpUrl 輔助函式 ───────────────────────────────────────────────

t('isSafeHttpUrl 對危險值與非字串都回 false', () => {
  for (const bad of [...DANGEROUS, null, undefined, 123, {}, '']) {
    assert.strictEqual(isSafeHttpUrl(bad), false, `${JSON.stringify(bad)} 應為 false`);
  }
});

t('isSafeHttpUrl 對正常網址回 true', () => {
  assert.strictEqual(isSafeHttpUrl('https://example.com'), true);
  assert.strictEqual(isSafeHttpUrl('  http://example.com  '), true);
});

// ─── 回歸防護：確認受影響的欄位真的套用了 ─────────────────────────────────

t('Embedding baseUrl 已限 http(s)（SSRF 面，後端會 fetch 它）', () => {
  const code = src('modules/settings/settings.routes.ts');
  assert.ok(code.includes('baseUrl: httpUrlSchema'), 'settings 的 baseUrl 未套用 httpUrlSchema');
  assert.ok(
    !code.includes('baseUrl: z.string().url()'),
    'settings 仍殘留不限 scheme 的 baseUrl',
  );
});

t('渠道 webhookBaseUrl 已限 http(s)', () => {
  const code = src('modules/channel/channel.routes.ts');
  assert.ok(code.includes('webhookBaseUrl: httpUrlSchema'), 'channel 的 webhookBaseUrl 未套用');
});

t('素材 previewImageUrl 已限 http(s)（前端當 <img src> 渲染）', () => {
  const code = src('modules/marketing/material.routes.ts');
  assert.ok(code.includes('previewImageUrl: httpUrlSchema'), 'material 的 previewImageUrl 未套用');
  assert.ok(
    !code.includes('previewImageUrl: z.string().url()'),
    'material 仍殘留不限 scheme 的 previewImageUrl',
  );
});

t('Rich Menu uri 已限 LINE 認可的 scheme（原本是裸 z.string()）', () => {
  const code = src('modules/line/rich-menu.routes.ts');
  assert.ok(code.includes('uri: lineUriSchema'), 'rich-menu 的 uri 未套用 lineUriSchema');
  assert.ok(
    !/^\s*uri: z\.string\(\)\.optional\(\),/m.test(code),
    'rich-menu 仍殘留裸 z.string() 的 uri',
  );
});

t('短連結 targetUrl 已限 http(s)（轉址頁會 window.location.replace 它）', () => {
  const code = src('modules/shortlink/shortlink.routes.ts');
  assert.ok(
    code.includes('TARGET_URL_SCHEME_RE') || code.includes('httpUrlSchema'),
    'shortlink 的 targetUrl 未限制 scheme',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
