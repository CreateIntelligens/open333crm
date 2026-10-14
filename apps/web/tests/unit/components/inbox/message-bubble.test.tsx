// @vitest-environment jsdom
/**
 * 收件匣訊息泡泡：登記與綁定的系統訊息、送出失敗的訊息（change add-phone-identity-merge，
 * spec phone-identity-merge「客服在對話中看得出需要處理的登記結果」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageBubble } from '#src/components/inbox/MessageBubble.js';

afterEach(cleanup);

const base = {
  id: 'm1',
  direction: 'OUTBOUND',
  contentType: 'text',
  senderType: 'BOT',
  createdAt: '2026-10-14T04:30:00Z',
};

test('需要客服確認', () => {
  render(
    <MessageBubble
      message={{
        ...base,
        content: { text: '無法自動整合帳號：使用這個手機號碼的顧客資料與您目前的資料不一致' },
        metadata: { source: 'identity_binding', kind: 'phone_identity_conflict' },
      }}
    />,
  );
  assert.ok(screen.getByText(/使用這個手機號碼的顧客資料與您目前的資料不一致/), '顯示訊息內容');
  assert.ok(screen.getByText('系統自動發送'));
  assert.ok(screen.getByText(/需要客服處理/));
  assert.ok(screen.getByText(/手動合併/));
});

test('一般的登記完成訊息只標示系統自動發送，不顯示需要處理', () => {
  render(
    <MessageBubble
      message={{ ...base, content: { text: '已登記您的手機號碼。' }, metadata: { source: 'identity_binding', kind: 'phone_registered' } }}
    />,
  );
  assert.ok(screen.getByText('系統自動發送'));
  assert.ok(screen.queryByText(/需要客服處理/) === null);
});

test('通知沒有送出', () => {
  render(
    <MessageBubble
      message={{
        ...base,
        content: { text: '已完成帳號整合：此帳號已與相同手機號碼的顧客資料整合為同一位顧客' },
        metadata: { source: 'identity_binding', kind: 'phone_merged', deliveryFailed: true, deliveryError: '綁定通知沒有送到顧客（綁定結果不受影響）' },
      }}
    />,
  );
  assert.ok(screen.getByText(/已完成帳號整合/), '仍顯示訊息內容');
  assert.ok(screen.getByText(/沒有送出/));
  assert.ok(screen.getByText(/綁定通知沒有送到顧客/), '顯示失敗原因');
});

test('沒有文字的訊息送出失敗時顯示類型', () => {
  render(
    <MessageBubble
      message={{ ...base, senderType: 'AGENT', contentType: 'line_video', content: { url: 'https://x/v.mp4' }, metadata: { deliveryFailed: true } }}
    />,
  );
  assert.ok(screen.getByText(/這則影片沒有送出/));
});
