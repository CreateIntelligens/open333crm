/**
 * 守門測試：確保所有「會連到使用者提供之第三方網址」的路徑都有目的地檢查。
 *   npx tsx src/__tests__/outbound-ssrf-coverage.test.ts
 *
 * 背景（PR Agent review 2026-09-22 第 4 點）：
 * scheme 白名單（httpUrlSchema）不是 SSRF 防護，真正擋內網的是目的地檢查。
 * 但光有檢查函式不夠——**新加的 outbound 呼叫點可能忘記套用**。
 * 本測試掃原始碼，讓漏掉的情況在 CI 就被擋下，而不是等上線後被打。
 *
 * 判準：只管「網址來自租戶輸入」的呼叫點。
 * 連到自家服務（Ollama）或固定的第三方 API（LINE／Facebook／Gemini）
 * 不在此列——那些位址不是使用者能控制的。
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
  try { fn(); console.log(`PASS  ${name}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${name}\n      ${(e as Error).message}`); fail += 1; }
}

/**
 * 每一項都是「租戶可自行填寫網址，後端會去連」的路徑。
 * 新增同類功能時請一併加進來。
 */
const GUARDED_CALL_SITES: Array<{ file: string; what: string; expect: RegExp }> = [
  {
    file: 'modules/webhook/downstream-forwarder.ts',
    what: '渠道 downstream webhook 轉發',
    expect: /isBlockedUrl\(/,
  },
  {
    file: 'modules/webhook-subscriptions/webhook-dispatcher.ts',
    what: 'Webhook 訂閱投遞',
    expect: /isBlockedUrl\(/,
  },
  {
    file: 'modules/webhook-subscriptions/webhook-subscription.routes.ts',
    what: 'Webhook 訂閱的建立／更新（存進去之前先擋）',
    expect: /isBlockedUrl\(/,
  },
  {
    file: 'modules/shortlink/og-scraper.ts',
    what: '短連結 OG 抓取（targetUrl 由租戶填）',
    expect: /hostIsBlocked\(/,
  },
];

for (const { file, what, expect } of GUARDED_CALL_SITES) {
  t(`${what} 有套目的地檢查`, () => {
    const code = src(file);
    assert.ok(
      expect.test(code),
      `${file} 會連到租戶提供的網址，但找不到目的地檢查（${expect}）。\n` +
      '      若這是新的 outbound 呼叫點，請套用 isBlockedUrl()；\n' +
      '      若網址並非使用者可控（自家服務／固定第三方 API），請從本清單移除並說明。',
    );
  });
}

t('會跟隨轉址的抓取必須停用自動 redirect', () => {
  // 轉址可能把我們導向內網——初始網址通過檢查不代表最終目的地安全
  const code = src('modules/shortlink/og-scraper.ts');
  assert.ok(/redirect:\s*'manual'/.test(code), 'og-scraper 未停用自動 redirect');
});

t('目的地檢查本身涵蓋雲端 metadata 與 loopback', () => {
  const code = src('modules/webhook/downstream-forwarder.ts');
  for (const cidr of ['169.254.0.0', '127.0.0.0', '10.0.0.0', '192.168.0.0', '100.64.0.0']) {
    assert.ok(code.includes(cidr), `isBlockedUrl 未涵蓋 ${cidr}`);
  }
  assert.ok(/::1/.test(code), 'isBlockedUrl 未涵蓋 IPv6 loopback');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
