'use client';

import { useEffect, useState } from 'react';
import { platformApi } from '../lib/platform-api';
import {
  CONTRACT_REMINDER_DAYS_KEY,
  DEFAULT_CONTRACT_REMINDER_DAYS,
  formatReminderDays,
  parseReminderDaysInput,
} from '../lib/contract-status';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

function apiErrorMessage(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
}

/**
 * 合約到期提醒天數設定卡（平台設定 contract.reminderDaysBefore）。
 * 只在按「儲存」時送出：輸入與離開欄位都不存檔，避免試用政策設定那種失焦即存的誤觸。
 */
export function ContractReminderCard() {
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    platformApi
      .get(`/settings/${CONTRACT_REMINDER_DAYS_KEY}`)
      .then((res) => {
        const value = res.data.data;
        const days = Array.isArray(value) && value.length > 0 ? (value as number[]) : DEFAULT_CONTRACT_REMINDER_DAYS;
        setInput(formatReminderDays(days));
      })
      .catch((err: unknown) => setNotice({ kind: 'error', text: `讀取提醒天數失敗：${apiErrorMessage(err) ?? '請重新整理頁面'}` }))
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    const parsed = parseReminderDaysInput(input);
    if (!parsed.ok) {
      setNotice({ kind: 'error', text: parsed.error });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await platformApi.put(`/settings/${CONTRACT_REMINDER_DAYS_KEY}`, { value: parsed.days });
      const saved: number[] = Array.isArray(res.data?.data?.value) ? res.data.data.value : parsed.days;
      setInput(formatReminderDays(saved));
      setNotice({ kind: 'ok', text: `已儲存合約到期提醒天數：${formatReminderDays(saved)}` });
    } catch (err: unknown) {
      // 失敗時保留使用者輸入，方便修改後重送
      setNotice({ kind: 'error', text: `儲存失敗：${apiErrorMessage(err) ?? '請稍後再試'}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={card}>
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>合約到期提醒</h2>
      <p style={{ color: '#66707f', fontSize: 12, margin: '0 0 12px' }}>
        合約迄日前幾天寄提醒信給所有啟用中的平台帳號。以逗號分隔多個天數，例如 30, 7, 1。合約到期不會自動停用租戶。
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="contract-reminder-days" style={{ fontSize: 13 }}>
          到期前提醒天數
        </label>
        <input
          id="contract-reminder-days"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!loaded}
          style={inp}
        />
        <button type="button" onClick={save} disabled={!loaded || saving} aria-label="儲存提醒天數" style={saveBtn}>
          {saving ? '儲存中…' : '儲存'}
        </button>
      </div>
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          style={{
            marginTop: 10,
            fontSize: 13,
            padding: '6px 12px',
            borderRadius: 8,
            background: notice.kind === 'ok' ? '#e4f5ec' : '#fdecea',
            color: notice.kind === 'ok' ? '#17935b' : '#d1443e',
          }}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18, marginTop: 20 };
const inp: React.CSSProperties = { border: '1px solid #e3e8ef', borderRadius: 8, padding: '7px 10px', fontSize: 14, width: 180 };
const saveBtn: React.CSSProperties = { background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
