/**
 * 營業時間設定的 schema（change settings-input-validation-and-credential-audit，
 * office-hours-settings「營業時間的輸入檢查」）。路由的行為見 tests/feature/modules/settings/office-hours-validation.test.ts。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { officeHoursSettingsSchema } from '#src/modules/settings/office-hours-settings.js';

const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const valid = () => ({
  timezone: 'Asia/Taipei',
  officeHours: {
    enabled: true,
    schedule: { ...closed, mon: { start: '09:00', end: '18:00' } },
    holidays: ['2026-12-25'],
    outsideHoursMessage: '非營業時間',
  },
});

/** 解析失敗時回傳 issues 的路徑（以 . 連接），成功時回傳空陣列 */
function issuePaths(input: unknown): string[] {
  const result = officeHoursSettingsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('營業時間的輸入檢查', () => {
  test('合法的邊界值可以儲存', () => {
    const input = valid();
    input.timezone = 'America/New_York';
    input.officeHours.schedule.mon = { start: '00:00', end: '23:59' };
    input.officeHours.holidays = ['2028-02-29'];
    input.officeHours.outsideHoursMessage = '字'.repeat(1000);
    assert.deepEqual(issuePaths(input), []);
    assert.deepEqual(issuePaths({ ...valid(), timezone: 'UTC' }), [], 'UTC 也是可以換算的時區');
    const atLimit = valid();
    atLimit.officeHours.holidays = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
    assert.deepEqual(issuePaths(atLimit), [], '366 筆假日');
  });

  test('結束時間不晚於開始時間', () => {
    for (const fri of [{ start: '22:00', end: '02:00' }, { start: '10:00', end: '10:00' }]) {
      const input = valid();
      (input.officeHours.schedule as Record<string, unknown>).fri = fri;
      assert.deepEqual(issuePaths(input), ['officeHours.schedule.fri'], JSON.stringify(fri));
    }
  });

  test('時間超出範圍', () => {
    const input = valid();
    input.officeHours.schedule.mon = { start: '99:99', end: '24:61' };
    assert.deepEqual(issuePaths(input).sort(), ['officeHours.schedule.mon.end', 'officeHours.schedule.mon.start']);
  });

  test('假日不是存在的日期', () => {
    for (const day of ['2026-02-30', 'abc', '2026-13-01', '2026-1-05']) {
      const input = valid();
      input.officeHours.holidays = ['2026-12-25', day];
      assert.deepEqual(issuePaths(input), ['officeHours.holidays.1'], day);
    }
  });

  test('假日超過 366 筆', () => {
    const input = valid();
    input.officeHours.holidays = Array.from({ length: 367 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
    assert.deepEqual(issuePaths(input), ['officeHours.holidays']);
  });

  test('時區不合法', () => {
    for (const timezone of ['Mars/Base', '', 'Asia/Taipei; DROP']) {
      assert.deepEqual(issuePaths({ ...valid(), timezone }), ['timezone'], timezone);
    }
  });

  test('訊息是空白或超過 1000 字', () => {
    for (const outsideHoursMessage of ['', '字'.repeat(1001)]) {
      const input = valid();
      input.officeHours.outsideHoursMessage = outsideHoursMessage;
      assert.deepEqual(issuePaths(input), ['officeHours.outsideHoursMessage'], `${outsideHoursMessage.length} 字`);
    }
  });
});
