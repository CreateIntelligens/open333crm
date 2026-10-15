// @vitest-environment jsdom
/**
 * 列表頁新增工單（S10）：工單渠道取聯絡人所在的渠道，不是 /channels 的第一個。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { CaseCreateModal } from '#src/components/case/CaseCreateModal.js';

const CH_A = 'c0000000-0000-0000-0000-00000000000a';
const CH_B = 'c0000000-0000-0000-0000-00000000000b';
const CH_C = 'c0000000-0000-0000-0000-00000000000c';

function contact(id: string, name: string, channels: Array<{ id: string; displayName: string }>) {
  return {
    id,
    displayName: name,
    channelIdentities: channels.map((c, i) => ({ id: `${id}-i${i}`, channelType: 'LINE', uid: `u${i}`, channel: { ...c, channelType: 'LINE' } })),
  };
}

let contacts: unknown[] = [];
beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/contacts')) return { data: { data: contacts } };
    if (url === '/channels') return { data: { data: [{ id: CH_A, name: '總店 LINE', type: 'LINE' }] } };
    return { data: { data: [] } };
  });
  api.post.mockReset().mockResolvedValue({ data: { data: { id: 'case-1' } } });
});

async function pickContact(name: string) {
  render(<CaseCreateModal open onOpenChange={vi.fn()} />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText('搜尋聯絡人姓名...'), { target: { value: name.slice(0, 2) } });
  fireEvent.click(await within(dialog).findByText(name));
  fireEvent.change(within(dialog).getByPlaceholderText('案件標題...'), { target: { value: '冷氣不冷' } });
  const category = within(dialog).getAllByRole('combobox').find((el) =>
    Array.from((el as HTMLSelectElement).options).some((o) => o.textContent === '請選擇分類'),
  ) as HTMLSelectElement;
  fireEvent.change(category, { target: { value: category.options[1].value } });
  return dialog;
}

test('聯絡人只在一個渠道：工單渠道就是那個渠道', async () => {
  contacts = [contact('d0000000-0000-0000-0000-000000000001', '陳小姐', [{ id: CH_B, displayName: '分店 LINE' }])];
  const dialog = await pickContact('陳小姐');
  fireEvent.click(within(dialog).getByRole('button', { name: '建立案件' }));

  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], '/cases');
  assert.equal(api.post.mock.calls[0][1].channelId, CH_B);
});

test('聯絡人在多個渠道：可選擇渠道，送出所選的渠道', async () => {
  contacts = [
    contact('d0000000-0000-0000-0000-000000000002', '林先生', [
      { id: CH_B, displayName: '分店 LINE' },
      { id: CH_C, displayName: '官網聊天' },
    ]),
  ];
  const dialog = await pickContact('林先生');
  const channelSelect = within(dialog).getAllByRole('combobox').find((el) =>
    Array.from((el as HTMLSelectElement).options).some((o) => o.value === CH_C),
  ) as HTMLSelectElement;
  assert.ok(channelSelect, '應出現渠道選單');
  fireEvent.change(channelSelect, { target: { value: CH_C } });
  fireEvent.click(within(dialog).getByRole('button', { name: '建立案件' }));

  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][1].channelId, CH_C);
});

test('聯絡人在看得到的渠道都沒有帳號：不能建立，並說明原因', async () => {
  contacts = [contact('d0000000-0000-0000-0000-000000000003', '王太太', [])];
  const dialog = await pickContact('王太太');
  assert.ok(within(dialog).queryByText(/沒有可建立工單的渠道/) !== null);
  assert.equal((within(dialog).getByRole('button', { name: '建立案件' }) as HTMLButtonElement).disabled, true);
});
