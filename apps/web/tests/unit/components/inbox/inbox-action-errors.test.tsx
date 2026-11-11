// @vitest-environment jsdom
/**
 * 收件匣操作失敗要讓客服看得到（S09）：送出訊息、改指派、改狀態失敗時畫面顯示原因，不只寫 console。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: null }) }));

import { MessageInput } from '#src/components/inbox/MessageInput.js';
import { ChatWindow } from '#src/components/inbox/ChatWindow.js';

const denied = { response: { status: 403, data: { error: { code: 'FORBIDDEN', message: '權限不足：需要「回覆對話」權限' } } } };

beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) =>
    url === '/agents'
      ? { data: { data: [{ id: 'a0000000-0000-0000-0000-000000000002', name: '王小明' }] } }
      : { data: { data: [], meta: {} } },
  );
  api.post.mockReset();
  api.patch.mockReset();
});

test('送出訊息失敗：輸入框下方顯示原因，訊息留在輸入框', async () => {
  const onSend = vi.fn(async () => {
    throw denied;
  });
  render(<MessageInput onSend={onSend} conversationId="conv-1" channelType="WEBCHAT" />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: '您好' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });

  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent ?? '', /權限不足/);
  assert.equal(textarea.value, '您好');
});

const conversation = {
  id: 'conv-1',
  channelType: 'WEBCHAT',
  status: 'ACTIVE',
  assignedToId: null,
  contact: { id: 'contact-1', name: '陳小姐' },
};

test('改指派失敗：聊天視窗顯示原因', async () => {
  api.patch.mockRejectedValue({ response: { status: 403, data: { error: { message: '權限不足：需要「管理對話」權限' } } } });
  render(<ChatWindow conversation={conversation} />);
  await screen.findByText('王小明');
  const assignSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  fireEvent.change(assignSelect, { target: { value: 'a0000000-0000-0000-0000-000000000002' } });

  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent ?? '', /管理對話/);
});

test('改狀態失敗：聊天視窗顯示原因', async () => {
  api.patch.mockRejectedValue({ response: { status: 403, data: { error: { message: '權限不足：需要「管理對話」權限' } } } });
  render(<ChatWindow conversation={conversation} />);
  const statusSelect = screen.getAllByRole('combobox').find((el) =>
    Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'AGENT_HANDLED'),
  ) as HTMLSelectElement;
  fireEvent.change(statusSelect, { target: { value: 'AGENT_HANDLED' } });

  await waitFor(() => assert.ok(screen.queryByRole('alert') !== null, '應顯示錯誤'));
  assert.match(screen.getByRole('alert').textContent ?? '', /管理對話/);
});

test('訊息超過 5000 字：不送出，直接說是字數超過上限（#293）', async () => {
  const onSend = vi.fn(async () => {});
  render(<MessageInput onSend={onSend} conversationId="conv-1" channelType="WEBCHAT" />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  const long = '字'.repeat(5001);
  fireEvent.change(textarea, { target: { value: long } });
  fireEvent.keyDown(textarea, { key: 'Enter' });

  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent ?? '', /不可超過 5000 字/);
  assert.equal(onSend.mock.calls.length, 0);
  assert.equal(textarea.value, long);
});

test('後端驗證失敗：顯示欄位層級的原因，而不是泛用的「輸入內容有誤」（#293）', async () => {
  const onSend = vi.fn(async () => {
    throw {
      response: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: '輸入內容有誤，請檢查後重新送出',
            details: { issues: [{ path: 'content', message: '訊息長度不可超過 5000 字' }] },
          },
        },
      },
    };
  });
  render(<MessageInput onSend={onSend} conversationId="conv-1" channelType="WEBCHAT" />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: '您好' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });

  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent ?? '', /訊息長度不可超過 5000 字/);
  assert.doesNotMatch(alert.textContent ?? '', /輸入內容有誤/);
});
