// @vitest-environment jsdom
/**
 * 自動化動作編輯器（問題清單 A05）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AUTOMATION_ACTION_DEFINITIONS } from '@open333crm/automation';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ActionEditor } from '#src/components/automation/ActionEditor.js';

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
