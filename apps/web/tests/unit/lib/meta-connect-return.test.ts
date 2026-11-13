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
