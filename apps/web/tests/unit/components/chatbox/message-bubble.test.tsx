// @vitest-environment jsdom
/**
 * `/chatbox` 的訊息泡泡：客服、Bot 的網址顯示成連結，訪客自己送出的網址維持純文字
 * （規格 webchat-widget「Web addresses in text messages are links」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ChatboxMessageOutput } from '@open333crm/shared';
import { MessageBubble } from '#src/components/chatbox/MessageBubble.js';

afterEach(cleanup);

const message = (direction: 'INBOUND' | 'OUTBOUND') =>
  ({
    id: `m-${direction}`,
    direction,
    type: 'text',
    payload: { text: '網址：https://example.com/a' },
    createdAt: new Date('2026-11-02T00:00:00Z').toISOString(),
  }) as unknown as ChatboxMessageOutput;

test('Chatbox message with an address：客服的訊息網址變成連結', () => {
  const { container } = render(<MessageBubble message={message('OUTBOUND')} />);
  assert.equal(container.querySelectorAll('a').length, 1);
  assert.equal(container.querySelector('a')?.getAttribute('href'), 'https://example.com/a');
});

test("Visitor's own address stays text：訪客自己送出的網址不變成連結", () => {
  const { container } = render(<MessageBubble message={message('INBOUND')} />);
  assert.equal(container.querySelectorAll('a').length, 0);
  assert.equal(container.querySelector('p')?.textContent, '網址：https://example.com/a');
});
