// @vitest-environment jsdom
/**
 * AI 建議回覆按「採用」（S07）：建議文字帶進回覆輸入框，客服可以修改後再送出。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { MessageInput } from '#src/components/inbox/MessageInput.js';

test('採用 AI 建議：文字出現在回覆輸入框', async () => {
  render(<MessageInput onSend={vi.fn(async () => undefined)} conversationId="conv-1" channelType="WEBCHAT" />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

  // 收件匣頁按「採用」時送出的事件（inbox/page.tsx）
  act(() => {
    window.dispatchEvent(new CustomEvent('ai-adopt', { detail: { text: '您好，冷氣請先確認濾網是否清潔。' } }));
  });

  assert.equal(textarea.value, '您好，冷氣請先確認濾網是否清潔。');
});
