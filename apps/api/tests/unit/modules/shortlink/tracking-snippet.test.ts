/**
 * 追蹤 script 只輸出合格的 ID（change fix-admin-settings-safeguards，tracking-settings「追蹤 script 只輸出合格的 ID」）。
 * 驗證上線前就存進資料庫的惡意值，輸出時也不可執行。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildTrackingSnippets } from '#src/modules/shortlink/strategies/tracking-snippet.js';

test('舊資料裡不合格的 ID 不輸出', () => {
  const html = buildTrackingSnippets("G-1');alert(1);//", "1');alert(2);//");
  assert.equal(html.includes('alert('), false);
  assert.equal(html.includes('googletagmanager'), false);
  assert.equal(html.includes('fbevents'), false);
});

test('舊資料裡含小寫字母的 GA ID 不輸出', () => {
  assert.equal(buildTrackingSnippets('g-ABC123XYZ9', null).includes('googletagmanager'), false);
  assert.equal(buildTrackingSnippets('G-abc123xyz9', null).includes('googletagmanager'), false);
});

test('合格的 ID 照常輸出', () => {
  const html = buildTrackingSnippets('G-ABC123XYZ9', '123456789012345');
  assert.ok(html.includes("gtag('config', 'G-ABC123XYZ9')"));
  assert.ok(html.includes('googletagmanager.com/gtag/js?id=G-ABC123XYZ9'));
  assert.ok(html.includes("fbq('init', '123456789012345')"));
});
