/**
 * Canvas 流程相關的純函式驗證：智慧發送時間視窗、郵件模板渲染、按鈕動作解析。
 *   npx tsx src/__tests__/canvas-flow.test.ts
 *
 * ⚠️ 這支測試原本用 vitest 撰寫，但專案從未安裝 vitest
 * （root 與 apps/api 的 package.json 都沒有），所以從寫出來到
 * 2026-09-23 為止從來沒有真正執行過。改寫成與其他測試一致的
 * node:assert + tsx 寫法。
 *
 * 改寫時移除了原本最後一個「Canvas flow simulation」案例：
 * 那個案例只是把 6 個事件物件推進一個本地陣列再斷言長度是 6，
 * 沒有呼叫任何專案程式碼，改了實作也不會紅——留著只會給人
 * 「跨渠道流程有測試覆蓋」的錯覺。真要驗那條流程需要整合測試環境。
 */
import assert from 'node:assert/strict';
// 走套件入口而非內部路徑——@open333crm/core 的 exports 只開放 "."，
// 原本的 '@open333crm/core/src/...' 會被 ERR_PACKAGE_PATH_NOT_EXPORTED 擋下。
// （這三個函式 index.ts 都有 re-export。）
import {
  checkSmartWindow,
  blockJsonToMjml,
  substituteMjmlVars,
  parseLineButton,
  parseFbButton,
} from '@open333crm/core';

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

/** 取某個時間點在指定時區的小時數 */
function hourIn(date: Date, timeZone: string): number {
  return Number(
    date.toLocaleString('en-US', { timeZone, hour: 'numeric', hour12: false }),
  );
}

// ─── 智慧發送時間視窗 ─────────────────────────────────────────────────────

t('活躍時段（台北 14:00）不調整時間', () => {
  const activeTime = new Date('2026-01-15T06:00:00Z'); // 14:00 Taipei (UTC+8)
  assert.equal(checkSmartWindow(activeTime, 'Asia/Taipei').getTime(), activeTime.getTime());
});

t('安靜時段（台北 02:00）延後到早上', () => {
  const quietTime = new Date('2026-01-15T18:00:00Z'); // 02:00 Taipei
  const adjusted = checkSmartWindow(quietTime, 'Asia/Taipei');
  assert.ok(
    hourIn(adjusted, 'Asia/Taipei') >= 9,
    `延後後應不早於 09:00，實際 ${hourIn(adjusted, 'Asia/Taipei')}:00`,
  );
});

t('深夜（台北 23:00）延後到之後的時間', () => {
  const lateNight = new Date('2026-01-15T15:00:00Z'); // 23:00 Taipei
  const adjusted = checkSmartWindow(lateNight, 'Asia/Taipei');
  assert.ok(adjusted.getTime() > lateNight.getTime(), '深夜時段應被延後');
});

// ─── 郵件模板：Block JSON → MJML ─────────────────────────────────────────

t('渲染標題區塊', () => {
  const mjml = blockJsonToMjml([{ type: 'header', content: 'Hello World' }]);
  assert.ok(mjml.includes('<mjml>'));
  assert.ok(mjml.includes('Hello World'));
  assert.ok(mjml.includes('mj-text'));
});

t('渲染按鈕區塊並帶上連結', () => {
  const mjml = blockJsonToMjml([
    { type: 'button', content: 'Click Me', href: 'https://example.com' },
  ]);
  assert.ok(mjml.includes('mj-button'));
  assert.ok(mjml.includes('https://example.com'));
  assert.ok(mjml.includes('Click Me'));
});

t('渲染多個區塊', () => {
  const mjml = blockJsonToMjml([
    { type: 'header', content: 'Title' },
    { type: 'text', content: 'Body text' },
    { type: 'divider' },
  ]);
  assert.ok(mjml.includes('Title'));
  assert.ok(mjml.includes('Body text'));
  assert.ok(mjml.includes('mj-divider'));
});

t('模板變數會被代入', () => {
  const result = substituteMjmlVars('<mj-text>Hello {{contact.name}}</mj-text>', {
    'contact.name': 'Alice',
  });
  assert.equal(result, '<mj-text>Hello Alice</mj-text>');
});

// ─── 按鈕動作解析：LINE ──────────────────────────────────────────────────

t('LINE：解析 canvas add_tag postback', () => {
  const action = parseLineButton({ type: 'postback', data: 'canvas:add_tag:tag-uuid-123' });
  assert.equal(action.type, 'add_tag');
  assert.equal(action.tagId, 'tag-uuid-123');
});

t('LINE：解析 canvas trigger_node postback', () => {
  const action = parseLineButton({ type: 'postback', data: 'canvas:trigger:node-uuid-456' });
  assert.equal(action.type, 'trigger_node');
  assert.equal(action.nodeId, 'node-uuid-456');
});

t('LINE：uri action 解析為 open_url', () => {
  const action = parseLineButton({ type: 'uri', uri: 'https://example.com/product' });
  assert.equal(action.type, 'open_url');
  assert.equal(action.url, 'https://example.com/product');
});

t('LINE：無法辨識的 postback 回 unknown（不可誤判成其他動作）', () => {
  assert.equal(parseLineButton({ type: 'postback', data: 'legacy:action' }).type, 'unknown');
});

// ─── 按鈕動作解析：Facebook ─────────────────────────────────────────────

t('FB：解析 canvas add_tag postback', () => {
  const btn = parseFbButton({
    type: 'postback',
    title: 'Interested',
    payload: 'canvas:add_tag:interested-tag',
  });
  assert.equal(btn.type, 'add_tag');
  assert.equal(btn.tagId, 'interested-tag');
});

t('FB：web_url 按鈕解析為 open_url', () => {
  const btn = parseFbButton({
    type: 'web_url',
    title: 'Visit Site',
    url: 'https://shop.example.com',
  });
  assert.equal(btn.type, 'open_url');
  assert.equal(btn.url, 'https://shop.example.com');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
