/**
 * 跨渠道綁定設定的驗證：email 登記欄位（change add-email-identity-merge，design D1）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { identityBindingSettingsSchema } from '#src/modules/settings/settings.routes.js';
import { applyIdentityBindingUpdate, findIdentityBindingKeywordIssue } from '#src/modules/identity-binding/binding-links.js';

const base = { enabled: true, bindKeywords: ['綁定帳號'], unbindKeywords: ['解除綁定'] };

test('接受 email 登記開關與關鍵字', () => {
  const data = identityBindingSettingsSchema.parse({ ...base, emailEnabled: true, emailKeywords: ['登記信箱'] });
  assert.equal(data.emailEnabled, true);
  assert.deepEqual(data.emailKeywords, ['登記信箱']);
});

test('沒送 email 欄位時沿用已儲存的設定，不會把 email 登記關掉', () => {
  const data = identityBindingSettingsSchema.parse(base);
  assert.equal(data.emailEnabled, undefined);
  const stored = { ...base, emailEnabled: true, emailKeywords: ['登記信箱'] };
  const next = applyIdentityBindingUpdate(stored, data);
  assert.equal(next.emailEnabled, true);
  assert.deepEqual(next.emailKeywords, ['登記信箱']);
  // 從未設定過時為預設值
  const fresh = applyIdentityBindingUpdate(null, data);
  assert.equal(fresh.emailEnabled, false);
  assert.deepEqual(fresh.emailKeywords, ['登記email']);
  // 有送就以送來的值為準
  assert.equal(applyIdentityBindingUpdate(stored, { ...data, emailEnabled: false }).emailEnabled, false);
});

test('email 登記關鍵字不可與綁定、解除關鍵字或確認字相同（檢查合併後要儲存的設定）', () => {
  for (const kw of ['綁定帳號', '解除綁定', '確認綁定']) {
    const value = applyIdentityBindingUpdate(null, identityBindingSettingsSchema.parse({ ...base, emailEnabled: true, emailKeywords: [kw] }));
    assert.equal(findIdentityBindingKeywordIssue(value)?.path, 'emailKeywords', kw);
  }
  assert.equal(findIdentityBindingKeywordIssue(applyIdentityBindingUpdate(null, identityBindingSettingsSchema.parse(base))), null);
});

test('沒送 email 關鍵字時，已儲存的自訂關鍵字與新的綁定關鍵字衝突也要擋下', () => {
  const stored = { ...base, emailEnabled: true, emailKeywords: ['自訂關鍵字'] };
  const data = identityBindingSettingsSchema.parse({ ...base, bindKeywords: ['自訂關鍵字'] });
  assert.equal(findIdentityBindingKeywordIssue(applyIdentityBindingUpdate(stored, data))?.path, 'emailKeywords');
});
