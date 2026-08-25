'use client';

import { useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '@/lib/constants';

export default function TrialSignupPage() {
  const [form, setForm] = useState({ email: '', siteName: '', password: '' });
  const [state, setState] = useState<'form' | 'sent'>('form');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await axios.post(`${API_BASE_URL}/trial/signups`, form);
      setState('sent');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
      if (code === 'TRIAL_CLOSED') setError('目前暫不開放試用申請，敬請期待。');
      else setError('申請失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    try {
      await axios.post(`${API_BASE_URL}/trial/resend`, { email: form.email });
    } catch {
      /* 一律成功回應 */
    }
  };

  return (
    <div style={wrap}>
      <div style={card}>
        {state === 'form' ? (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>免費試用 open333 CRM</h1>
            <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>
              填寫資料 → 收信驗證 → 系統立即為您開通試用站台。
            </p>
            <form onSubmit={submit}>
              <label style={label}>Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inp} />
              <label style={label}>站台名稱</label>
              <input required value={form.siteName} onChange={(e) => setForm({ ...form, siteName: e.target.value })} style={inp} />
              <label style={label}>設定密碼（至少 8 碼）</label>
              <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inp} />
              {error && <div style={{ color: '#d1443e', fontSize: 13, marginBottom: 12 }}>{error}</div>}
              <button type="submit" disabled={submitting} style={btn}>
                {submitting ? '送出中…' : '申請免費試用'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>請至信箱完成驗證 📬</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>
              我們已寄出驗證信到 <strong>{form.email}</strong>。點擊信中連結即可完成開通。
            </p>
            <p style={{ color: '#97a0ae', fontSize: 13, marginTop: 16 }}>
              沒收到信？{' '}
              <button onClick={resend} style={linkBtn}>
                重新寄送
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d9488', fontFamily: 'system-ui, sans-serif' };
const card: React.CSSProperties = { background: '#fff', padding: 32, borderRadius: 12, width: 380, boxShadow: '0 8px 30px rgba(0,0,0,.2)' };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: 'block' };
const inp: React.CSSProperties = { width: '100%', border: '1px solid #e3e8ef', borderRadius: 8, padding: '9px 11px', fontSize: 14, marginTop: 4, marginBottom: 14, boxSizing: 'border-box' };
const btn: React.CSSProperties = { width: '100%', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#0d9488', cursor: 'pointer', textDecoration: 'underline', fontSize: 13, padding: 0 };
