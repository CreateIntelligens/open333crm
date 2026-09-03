'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { platformApi } from '../lib/platform-api';
import { AuthShell } from '../lib/AuthShell';
import { C, input, label, focusRing, btnPrimary, primaryHover } from '../lib/ui';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await platformApi.post('/auth/reset-password', { token, newPassword });
      setDone(true);
      setTimeout(() => router.replace('/admin/login'), 2000);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          '重設失敗',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="重設密碼">
      {!token ? (
        <div style={{ color: C.danger, fontSize: 13.5, lineHeight: 1.6 }}>
          缺少重設連結參數，請重新申請忘記密碼。
        </div>
      ) : done ? (
        <div
          style={{
            background: C.okSoft,
            color: C.ok,
            padding: '12px 16px',
            borderRadius: 10,
            fontSize: 13.5,
            border: 'rgba(23,147,91,.18) solid 1px',
          }}
        >
          密碼已重設，即將導向登入頁…
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>請輸入新密碼。</p>
          <div>
            <label style={label}>新密碼（至少 8 碼）</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              style={input}
              {...focusRing}
            />
          </div>
          {error && <div style={{ color: C.danger, fontSize: 13, margin: '-4px 0 0' }}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            style={{ ...btnPrimary, width: '100%', padding: '11px', opacity: submitting ? 0.6 : 1 }}
            {...primaryHover}
          >
            {submitting ? '送出中…' : '重設密碼'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
