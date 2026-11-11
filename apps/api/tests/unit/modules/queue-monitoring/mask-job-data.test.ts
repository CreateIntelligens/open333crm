/**
 * job 資料只顯示識別欄位（change queue-monitoring：queue-monitoring「job 資料只顯示識別欄位」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MASKED, maskJobData } from '#src/modules/queue-monitoring/mask-job-data.js';

test('遮蔽訊息內容', () => {
  const masked = maskJobData({
    eventId: 'e1',
    name: 'message.received',
    tenantId: 't1',
    payload: { contactId: 'c1', content: '我的電話是 0912…' },
  });

  assert.deepEqual(masked, {
    eventId: 'e1',
    name: 'message.received',
    tenantId: 't1',
    payload: { contactId: 'c1', content: MASKED },
  });
});

test('巢狀的 name 不是識別欄位', () => {
  const masked = maskJobData({ name: 'contact.created', payload: { name: '王小明' } });

  assert.deepEqual(masked, { name: 'contact.created', payload: { name: MASKED } });
});

test('最上層的 type 是識別欄位，巢狀的 type 不是', () => {
  assert.deepEqual(maskJobData({ type: 'case_assigned', context: { type: 'secret' } }), {
    type: 'case_assigned',
    context: { type: MASKED },
  });
});

test('陣列的每個元素依同樣規則處理', () => {
  const masked = maskJobData({
    uids: ['U1', 'U2'],
    recipients: [{ agentId: 'a1', email: 'a@example.com' }, { id: 7, phone: '0912' }],
  });

  assert.deepEqual(masked, {
    uids: [MASKED, MASKED],
    recipients: [{ agentId: 'a1', email: MASKED }, { id: 7, phone: MASKED }],
  });
});

test('新增的欄位預設遮蔽', () => {
  assert.deepEqual(maskJobData({ tenantId: 't1', newField: 'x', count: 3, flag: true, nothing: null }), {
    tenantId: 't1',
    newField: MASKED,
    count: MASKED,
    flag: MASKED,
    nothing: MASKED,
  });
});

test('識別欄位的值不是字串或數字時遮蔽', () => {
  assert.deepEqual(maskJobData({ contactId: { raw: '0912' }, caseId: ['c1'], ruleId: null }), {
    contactId: { raw: MASKED },
    caseId: [MASKED],
    ruleId: MASKED,
  });
});

test('job 資料本身不是物件時遮蔽', () => {
  assert.equal(maskJobData('0912-345-678'), MASKED);
  assert.equal(maskJobData(undefined), undefined);
});

test('名稱為 __proto__ 的欄位照常遮蔽，不改變結果的原型', () => {
  // JSON.parse 會把 __proto__ 建成一般欄位；以指派寫入時會改掉結果的原型，這個欄位就從畫面上消失
  const masked = maskJobData(JSON.parse('{"tenantId":"t1","__proto__":{"phone":"0912"}}')) as Record<string, unknown>;

  assert.equal(Object.getPrototypeOf(masked), Object.prototype);
  assert.equal(JSON.stringify(masked), JSON.stringify(JSON.parse(`{"tenantId":"t1","__proto__":{"phone":"${MASKED}"}}`)));
});
