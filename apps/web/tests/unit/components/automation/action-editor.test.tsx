// @vitest-environment jsdom
/**
 * 自動化動作編輯器（問題清單 A05）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { AUTOMATION_ACTION_DEFINITIONS } from '@open333crm/automation';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ActionEditor } from '#src/components/automation/ActionEditor.js';

// 每個測試用自己的 SWR 快取，前一個測試載入的名單不會帶到下一個測試
const render = (ui: React.ReactElement) =>
  rtlRender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const definitions = [...AUTOMATION_ACTION_DEFINITIONS];

beforeEach(() => {
  api.get.mockReset();
});

// 第 0 個下拉是「動作類型」，第 1 個是參數
function selectedLabel(select: HTMLSelectElement): string {
  return select.options[select.selectedIndex]?.textContent ?? '';
}

for (const [type, paramLabel, firstOption] of [
  ['update_case_status', '目標狀態', '開啟'],
  ['set_case_priority', '優先級', '低'],
] as const) {
  test(`必填下拉（${paramLabel}）未選時顯示「請選擇」，不顯示第一個選項「${firstOption}」`, () => {
    const onChange = vi.fn();
    render(
      <ActionEditor
        action={{ type, payload: {} }}
        actionDefinitions={definitions}
        onChange={onChange}
        onRemove={() => {}}
      />,
    );
    const select = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    assert.equal(select.value, '');
    assert.equal(selectedLabel(select), `請選擇${paramLabel}`);

    fireEvent.change(select, { target: { value: select.options[1]!.value } });
    assert.deepEqual(onChange.mock.calls.at(-1)?.[0].payload, {
      [type === 'update_case_status' ? 'status' : 'priority']: select.options[1]!.value,
    });
  });
}

test('選填下拉維持「不指定」', () => {
  render(
    <ActionEditor
      action={{ type: 'escalate_case', payload: {} }}
      actionDefinitions={definitions}
      onChange={() => {}}
      onRemove={() => {}}
    />,
  );
  const select = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
  assert.equal(selectedLabel(select), '不指定');
});

// ── 傳送通知的收件人（change fix-automation-rule-gaps，問題清單 A03）──
test('傳送通知可選「通知誰」，不指定時說明會通知負責人', async () => {
  api.get.mockResolvedValue({ data: { data: [{ id: 'a1', name: '王小明', email: 'ming@example.com' }] } });
  const onChange = vi.fn();
  render(
    <ActionEditor
      action={{ type: 'notify', payload: { message: '請處理' } }}
      actionDefinitions={definitions}
      onChange={onChange}
      onRemove={() => {}}
    />,
  );
  const select = (await screen.findAllByRole('combobox'))[1] as HTMLSelectElement;
  assert.equal(selectedLabel(select), '不指定（通知負責人，沒有負責人時通知主管）');
  await screen.findByRole('option', { name: '王小明（ming@example.com）' });
  fireEvent.change(select, { target: { value: 'a1' } });
  assert.deepEqual(onChange.mock.calls.at(-1)?.[0].payload, { message: '請處理', agentId: 'a1' });
});

// ── 傳送素材從素材庫挑選（change fix-automation-rule-gaps，問題清單 A04）──
const materialsPage = {
  data: {
    data: [
      { id: 'm-line', name: '歡迎訊息', channelType: 'line', contentType: 'text' },
      { id: 'm-fb', name: '週年慶', channelType: 'fb', contentType: 'image' },
    ],
    meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
  },
};

function renderSendMaterial(materialId = '') {
  const onChange = vi.fn();
  render(
    <ActionEditor
      action={{ type: 'send_material', payload: materialId ? { materialId } : {} }}
      actionDefinitions={definitions}
      onChange={onChange}
      onRemove={() => {}}
    />,
  );
  return onChange;
}

test('從清單選素材', async () => {
  api.get.mockResolvedValue(materialsPage);
  const onChange = renderSendMaterial();
  await screen.findByRole('option', { name: '歡迎訊息（LINE）' });
  const select = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'm-line' } });
  assert.deepEqual(onChange.mock.calls.at(-1)?.[0].payload, { materialId: 'm-line' });
  assert.ok(String(api.get.mock.calls[0]?.[0]).includes('isActive=true'));
});

test('已存的素材被停用', async () => {
  api.get.mockResolvedValue(materialsPage);
  renderSendMaterial('00000000-dead-0000-0000-000000000000');
  await screen.findByRole('option', { name: '歡迎訊息（LINE）' });
  const select = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
  assert.equal(select.value, '00000000-dead-0000-0000-000000000000');
  assert.match(selectedLabel(select), /^已停用或找不到的素材/);
});

test('沒有素材檢視權限', async () => {
  api.get.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
  const onChange = renderSendMaterial();
  await screen.findByText(/無法載入素材清單/);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'm-typed' } });
  assert.deepEqual(onChange.mock.calls.at(-1)?.[0].payload, { materialId: 'm-typed' });
});
