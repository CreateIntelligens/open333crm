/**
 * 自動化規則編輯器的「加入好友」事件（add-coupon-system A15 15.16；design D28；
 * spec automation-engine「加入好友事件」：事件清單列出「加入好友」，可選傳送訊息、傳送素材，發券在加好友禮頁設定）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getAutomationActionOptionsForEvent, getAutomationFieldOptionsForEvent } from '@open333crm/automation';
import { triggerEventOptions } from '#src/lib/automation/rule-actions.js';

test('事件清單列出「加入好友」，不標示目前不會觸發', () => {
  const option = triggerEventOptions('message.received').find((o) => o.value === 'contact.followed');
  assert.deepEqual(option, { value: 'contact.followed', label: '加入好友' });
});

test('加入好友可選傳送訊息、傳送素材；發送優惠券不在編輯器的動作選單', () => {
  const editable = getAutomationActionOptionsForEvent('contact.followed')
    .filter((o) => !o.definition.editorHidden)
    .map((o) => o.value);
  assert.ok(editable.includes('send_message'));
  assert.ok(editable.includes('send_material'));
  assert.equal(editable.includes('issue_coupon'), false);
});

test('條件「第一次加入」只在加入好友事件提供', () => {
  const field = getAutomationFieldOptionsForEvent('contact.followed').find((f) => f.name === 'follow.isFirst');
  assert.equal(field?.label, '第一次加入');
  assert.equal(getAutomationFieldOptionsForEvent('message.received').some((f) => f.name === 'follow.isFirst'), false);
});
