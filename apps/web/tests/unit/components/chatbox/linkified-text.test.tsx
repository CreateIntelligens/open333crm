// @vitest-environment jsdom
/**
 * `/chatbox` 文字訊息中的網址顯示成連結
 * （規格 webchat-widget「Web addresses in text messages are links」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LinkifiedText } from '#src/components/chatbox/LinkifiedText.js';

afterEach(cleanup);

test('Chatbox message with an address：網址變成另開分頁的連結，結尾的「。」不算進連結', () => {
  const { container } = render(<LinkifiedText text="網址：https://example.com/a。" />);
  const links = container.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0]!.getAttribute('href'), 'https://example.com/a');
  assert.equal(links[0]!.textContent, 'https://example.com/a');
  assert.equal(links[0]!.getAttribute('target'), '_blank');
  assert.equal(links[0]!.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(container.textContent, '網址：https://example.com/a。');
});

test('Other schemes stay text：javascript: 不產生連結，HTML 標籤以文字顯示', () => {
  const { container } = render(<LinkifiedText text={'javascript:alert(1) <b>粗體</b>'} />);
  assert.equal(container.querySelectorAll('a, b').length, 0);
  assert.equal(container.textContent, 'javascript:alert(1) <b>粗體</b>');
});
