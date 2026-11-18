import assert from 'node:assert/strict';
import { test } from 'vitest';
import { safeMetaConnectReturnTo } from '#src/lib/meta-connect-return.js';

test('站內路徑：連結完成後導回', () => {
  assert.equal(safeMetaConnectReturnTo('/dashboard/comment-replies'), '/dashboard/comment-replies');
  assert.equal(safeMetaConnectReturnTo('/dashboard/comment-replies?tab=logs'), '/dashboard/comment-replies?tab=logs');
});

test('外部網址與協定相對網址不導回', () => {
  assert.equal(safeMetaConnectReturnTo('https://evil.example/x'), null);
  assert.equal(safeMetaConnectReturnTo('//evil.example/x'), null);
  assert.equal(safeMetaConnectReturnTo('/\\evil.example'), null);
  assert.equal(safeMetaConnectReturnTo('javascript:alert(1)'), null);
});

test('沒有帶 returnTo', () => {
  assert.equal(safeMetaConnectReturnTo(null), null);
  assert.equal(safeMetaConnectReturnTo(''), null);
});

// PR #526 CodeQL js/client-side-unvalidated-url-redirection：瀏覽器解析網址時會刪掉 tab、換行，
// `/\t/evil.example` 會變成 `//evil.example`（協定相對網址）
test('夾 tab、換行或空白的路徑不導回', () => {
  assert.equal(safeMetaConnectReturnTo('/\t/evil.example'), null);
  assert.equal(safeMetaConnectReturnTo('/\n/evil.example'), null);
  assert.equal(safeMetaConnectReturnTo('/\r/evil.example'), null);
  assert.equal(safeMetaConnectReturnTo('/ /evil.example'), null);
});

test('與後端 returnTo 規則一致：只接受 /dashboard/ 開頭', () => {
  assert.equal(safeMetaConnectReturnTo('/login'), null);
  assert.equal(safeMetaConnectReturnTo('/dashboard//evil.example'), null);
});
