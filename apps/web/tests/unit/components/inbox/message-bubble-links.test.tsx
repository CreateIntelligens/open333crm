// @vitest-environment jsdom
/**
 * 收件匣文字訊息中的網址是連結（change inbox-message-links，spec core-inbox
 * 「Inbox text messages show web addresses as links」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessageBubble } from '#src/components/inbox/MessageBubble.js';

afterEach(cleanup);

const base = {
  id: 'm1',
  contentType: 'text',
  createdAt: '2026-11-02T06:30:00Z',
};

test('Customer message with an address', () => {
  const { container } = render(
    <MessageBubble message={{ ...base, direction: 'INBOUND', senderType: 'CONTACT', content: { text: '我看 https://example.com/p/1 這頁' } }} />,
  );
  const links = container.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), 'https://example.com/p/1');
  assert.equal(links[0].getAttribute('target'), '_blank');
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(links[0].parentElement?.textContent, '我看 https://example.com/p/1 這頁');
});

test('Bot reply with an address', () => {
  const { container } = render(
    <MessageBubble message={{ ...base, direction: 'OUTBOUND', senderType: 'BOT', content: { text: '請看 https://example.com/manual—有問題再問我' } }} />,
  );
  const links = container.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), 'https://example.com/manual');
  assert.equal(links[0].textContent, 'https://example.com/manual');
});

test('Other schemes and HTML stay text', () => {
  const text = 'javascript:alert(1) <a href="https://x.test">x</a>';
  const { container } = render(
    <MessageBubble message={{ ...base, direction: 'INBOUND', senderType: 'CONTACT', content: { text } }} />,
  );
  for (const a of container.querySelectorAll('a')) {
    assert.ok(!a.getAttribute('href')?.startsWith('javascript:'), 'javascript: 不建立連結');
    assert.ok(a.textContent !== 'x', 'HTML 標籤不會被解析成元素');
  }
  assert.ok(container.textContent?.includes('<a href="https://x.test">x</a>'), 'HTML 標籤以文字顯示');
});

test('System notice stays text', () => {
  const { container } = render(
    <MessageBubble message={{ ...base, direction: 'OUTBOUND', senderType: 'SYSTEM', contentType: 'system', content: { text: '請看 https://example.com' } }} />,
  );
  assert.equal(container.querySelectorAll('a').length, 0);
});
