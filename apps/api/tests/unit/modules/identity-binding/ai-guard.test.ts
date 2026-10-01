/**
 * AI 回覆不可偽造綁定代碼（UAT 2026-10-01 實測：顧客打錯關鍵字交給 AI，AI 照對話紀錄裡的綁定訊息
 * 編出一則完整導流訊息與不存在的代碼）。change add-cross-channel-one-id。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { containsBindingCode, guardAiReply, toAiHistory } from '#src/modules/identity-binding/ai-guard.js';

const enabled = { enabled: true, bindKeywords: ['綁定帳號'], unbindKeywords: ['解除綁定'] };
const disabled = { enabled: false, bindKeywords: ['綁定帳號'], unbindKeywords: ['解除綁定'] };

test('偵測代碼：正式格式、小寫、AI 亂編的長度都算；一般文字不算', () => {
  assert.equal(containsBindingCode('代碼 BIND-5W5PZ472M9'), true);
  assert.equal(containsBindingCode('https://m.me/1?ref=bind-5w5pz472m9'), true);
  assert.equal(containsBindingCode('請輸入 BIND-ABC123'), true, '長度不對的假代碼也要擋');
  assert.equal(containsBindingCode('%E4%BB%A3%E7%A2%BC%20BIND-5W5PZ472M9%EF'), true, '網址編碼裡的代碼');
  assert.equal(containsBindingCode('您好，請問要綁定哪個帳號？'), false);
  assert.equal(containsBindingCode('REBIND-LATER 是設定名稱'), false);
});

test('對話紀錄：系統發的綁定訊息不給 AI 看；其他訊息裡的代碼遮掉', () => {
  const history = toAiHistory([
    { direction: 'INBOUND', content: { text: '綁定帳號' }, metadata: null },
    { direction: 'OUTBOUND', content: { text: '請選擇要綁定的帳號…代碼 BIND-75G6P389DQ' }, metadata: { source: 'identity_binding', kind: 'invite' } },
    { direction: 'INBOUND', content: { text: '我要綁定帳號，代碼 BIND-75G6P389DQ（請直接送出）' }, metadata: null },
    { direction: 'OUTBOUND', content: { text: '好的' }, metadata: { source: 'agentic_llm' } },
    { direction: 'OUTBOUND', content: { image: 'x' }, metadata: null },
  ]);
  assert.deepEqual(history, [
    { role: 'user', content: '綁定帳號' },
    { role: 'user', content: '我要綁定帳號，代碼 [綁定代碼]（請直接送出）' },
    { role: 'assistant', content: '好的' },
  ]);
});

test('AI 回覆含代碼：整則換成固定說明（綁定已啟用時引導傳送關鍵字），並標記已攔截', () => {
  const r = guardAiReply('請選擇要綁定的帳號…代碼 BIND-5W5PZ472M9', enabled);
  assert.equal(r.blocked, true);
  assert.ok(!containsBindingCode(r.text));
  assert.match(r.text, /「綁定帳號」/);
});

test('AI 回覆含代碼、但租戶沒啟用綁定：不引導關鍵字，改請洽客服', () => {
  const r = guardAiReply('您的代碼是 BIND-ABCDEFGHJK', disabled);
  assert.equal(r.blocked, true);
  assert.doesNotMatch(r.text, /綁定帳號」/);
  assert.match(r.text, /客服/);
});

test('一般 AI 回覆不受影響', () => {
  assert.deepEqual(guardAiReply('您好，有什麼可以幫您？', enabled), { text: '您好，有什麼可以幫您？', blocked: false });
});

test('依租戶設定把關：啟用時引導租戶自訂的關鍵字；沒含代碼時不讀設定', async () => {
  const { guardAiReplyForTenant } = await import('#src/modules/identity-binding/ai-guard.js');
  const { invalidateIdentityBindingSettings } = await import('#src/modules/identity-binding/identity-binding.service.js');
  let reads = 0;
  const db = {
    tenantSettings: {
      findFirst: async () => {
        reads++;
        return { identityBinding: { enabled: true, bindKeywords: ['我要綁定'] } };
      },
    },
  } as never;
  const tenantId = 'ai-guard-tenant';
  invalidateIdentityBindingSettings(tenantId);
  assert.deepEqual(await guardAiReplyForTenant(db, tenantId, '一般回覆', { source: 'test' }), { text: '一般回覆', blocked: false });
  assert.equal(reads, 0);
  const r = await guardAiReplyForTenant(db, tenantId, '代碼 BIND-5W5PZ472M9', { source: 'test' });
  assert.equal(r.blocked, true);
  assert.match(r.text, /「我要綁定」/);
});
