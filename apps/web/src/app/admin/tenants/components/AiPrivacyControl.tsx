'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { platformApi } from '../../lib/platform-api';

function readEnabled(data: unknown): boolean {
  const value = (data as { enabled?: unknown } | null)?.enabled;
  if (typeof value !== 'boolean') throw new Error('Invalid privacy policy');
  return value;
}

export function AiPrivacyControl({ tenantId }: { tenantId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const descriptionId = useId();

  useEffect(() => {
    const current = ++generation.current;
    setEnabled(null);
    setSaving(false);
    setError('');
    setNotice('');
    platformApi.get(`/tenants/${tenantId}/ai-privacy`).then((response) => {
      const value = readEnabled(response.data.data);
      if (generation.current === current) setEnabled(value);
    }).catch(() => {
      if (generation.current === current) setError('去識別化設定載入失敗，請重新載入。');
    });
    return () => { generation.current += 1; };
  }, [tenantId, reload]);

  const toggle = async () => {
    if (enabled === null || saving) return;
    const current = generation.current;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await platformApi.patch(`/tenants/${tenantId}/ai-privacy`, { enabled: !enabled });
      const confirmed = readEnabled(response.data.data);
      if (generation.current === current) {
        setEnabled(confirmed);
        setNotice(confirmed ? '已強制啟用個資遮罩' : '已關閉個資遮罩');
      }
    } catch {
      if (generation.current === current) setError('去識別化設定儲存失敗，請重試。');
    } finally {
      if (generation.current === current) setSaving(false);
    }
  };

  return (
    <section aria-labelledby={`${descriptionId}-heading`} style={{ background: '#fff', border: '1px solid #e3e8ef', borderRadius: 12, padding: 18, marginTop: 20, minWidth: 280 }}>
      <h2 id={`${descriptionId}-heading`} style={{ fontSize: 16, margin: '0 0 12px' }}>個資遮罩</h2>
      <p id={descriptionId} style={{ color: '#526071', fontSize: 13, lineHeight: 1.7, maxWidth: '72ch', margin: '0 0 14px' }}>
        預設關閉。啟用後，此租戶送往模型的文字會先交由 2md.ai 處理，以類別標記遮罩個資。
        平台強制啟用後由平台管理員控制，租戶端無法關閉；去識別化服務異常時，暫停該次模型呼叫。
        原始客服紀錄仍依既有保存規則保留。
      </p>
      <button
        type="button"
        role="switch"
        aria-label="強制啟用個資遮罩"
        aria-checked={enabled ?? false}
        aria-describedby={descriptionId}
        disabled={enabled === null || saving}
        onClick={() => { void toggle(); }}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 enabled:hover:bg-teal-50 disabled:cursor-wait disabled:opacity-60"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 12, border: '1px solid #cdd5e0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#334155', minHeight: 44 }}
      >
        <span>強制啟用個資遮罩</span>
        <span style={{ color: enabled ? '#087f75' : '#526071', fontWeight: 600 }}>
          {saving ? '儲存中…' : enabled === null ? '讀取設定中…' : enabled ? '已啟用' : '已關閉'}
        </span>
      </button>
      {error && (
        <div style={{ marginTop: 12 }}>
          <p role="alert" style={{ color: '#b32f2a', fontSize: 13, margin: '0 0 8px' }}>{error}</p>
          {enabled === null && (
            <button type="button" onClick={() => setReload((value) => value + 1)} aria-label="重新載入去識別化設定" className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700" style={{ color: '#087f75', fontSize: 13 }}>
              重新載入
            </button>
          )}
        </div>
      )}
      {notice && <p role="status" style={{ color: '#087f75', fontSize: 13, margin: '12px 0 0' }}>{notice}</p>}
    </section>
  );
}
