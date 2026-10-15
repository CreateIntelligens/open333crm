// @vitest-environment jsdom
/**
 * 報表日期區間（G10）：日期框的值是本地日期，迄日要算到當天結束；清空日期框不可讓頁面崩潰。
 * 原本 new Date('YYYY-MM-DD') 以 UTC 解析，台灣時間迄日只算到 08:00。
 */
process.env.TZ = 'Asia/Taipei';

import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DateRangePicker } from '#src/components/analytics/DateRangePicker.js';

afterEach(cleanup);

function setup(from: Date, to: Date) {
  const onChange = vi.fn();
  const { container } = render(<DateRangePicker from={from} to={to} onChange={onChange} />);
  const [fromInput, toInput] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
  return { onChange, fromInput, toInput };
}

test('迄日以本地時間算到當天結束', () => {
  const { onChange, toInput } = setup(new Date(2026, 9, 1), new Date(2026, 9, 10));
  fireEvent.change(toInput, { target: { value: '2026-10-15' } });
  const [, to] = onChange.mock.calls[0] as [Date, Date];
  assert.deepEqual(
    [to.getFullYear(), to.getMonth(), to.getDate(), to.getHours(), to.getMinutes()],
    [2026, 9, 15, 23, 59],
  );
});

test('起日以本地時間從當天 0 點開始', () => {
  const { onChange, fromInput } = setup(new Date(2026, 9, 1), new Date(2026, 9, 10));
  fireEvent.change(fromInput, { target: { value: '2026-10-03' } });
  const [from] = onChange.mock.calls[0] as [Date, Date];
  assert.deepEqual([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()], [2026, 9, 3, 0]);
});

test('日期框顯示本地日期', () => {
  // 台灣時間 10/15 早上 7 點 = UTC 10/14 23:00
  const { toInput } = setup(new Date(2026, 9, 1), new Date(2026, 9, 15, 7, 0));
  assert.equal(toInput.value, '2026-10-15');
});

test('清空日期框不會送出無效日期', () => {
  const { onChange, fromInput, toInput } = setup(new Date(2026, 9, 1), new Date(2026, 9, 10));
  fireEvent.change(fromInput, { target: { value: '' } });
  fireEvent.change(toInput, { target: { value: '' } });
  assert.equal(onChange.mock.calls.length, 0);
});

test('收到無效日期時不崩潰', () => {
  const { fromInput } = setup(new Date(Number.NaN), new Date(2026, 9, 10));
  assert.equal(fromInput.value, '');
});
