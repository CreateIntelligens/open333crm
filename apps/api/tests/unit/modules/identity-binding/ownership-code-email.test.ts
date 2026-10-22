/**
 * 驗證信的主旨不放驗證碼：寄信方式為 log 時會寫進 log，信件預覽也會直接露出。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildVerificationEmail } from '#src/modules/identity-binding/ownership-code-email.js';

test('主旨不含驗證碼，內文有', () => {
  const mail = buildVerificationEmail('好好咖啡', '493817');
  assert.ok(!mail.subject.includes('493817'), mail.subject);
  assert.ok(mail.html.includes('493817'));
  assert.ok(mail.text.includes('493817'));
});
