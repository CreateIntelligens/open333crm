'use client';

import { useState } from 'react';
import { platformApi } from '../lib/platform-api';
import { AuthShell } from '../lib/AuthShell';
import { C, input, label, focusRing, btnPrimary, primaryHover } from '../lib/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await platformApi.post('/auth/forgot-password', { email });
    } catch {
      // 防枚舉：無論成功或失敗一律顯示相同結果
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  return (
    <AuthShell title="忘記密碼" subtitle="輸入平台帳號 Email，我們將寄送重設連結。">
      {submitted ? (
        <div
          style={{
            background: C.okSoft,
            color: C.ok,
            padding: '12px 16px',
            borderRadius: 10,
            fontSize: 13.5,
            lineHeight: 1.6,
            border: 'rgba(23,147,91,.18) solid 1px',
          }}
        >
          若此 Email 存在，重設信已寄出，請至信箱查收。
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={label}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={input} {...focusRing} />
          </div>
          <button
            type="submit"
            disabled={submitting}
            style={{ ...btnPrimary, width: '100%', padding: '11px', opacity: submitting ? 0.6 : 1 }}
            {...primaryHover}
          >
            {submitting ? '送出中…' : '寄送重設連結'}
          </button>
        </form>
      )}
      <a
        href="/admin/login"
        style={{ display: 'block', textAlign: 'center', marginTop: 18, fontSize: 13, color: C.muted, textDecoration: 'none' }}
      >
        返回登入
      </a>
    </AuthShell>
  );
}
