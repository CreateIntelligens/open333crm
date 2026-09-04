'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { platformApi, setPlatformToken, setMustChangePassword } from '../lib/platform-api';
import { AuthShell } from '../lib/AuthShell';
import { C, input, label, focusRing, btnPrimary, primaryHover } from '../lib/ui';

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await platformApi.post('/auth/login', { email, password });
      setPlatformToken(res.data.data.token);
      if (res.data.data.user?.mustChangePassword) {
        setMustChangePassword(true);
        router.replace('/admin/change-password?forced=1');
      } else {
        setMustChangePassword(false);
        router.replace('/admin/plans');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? '登入失敗';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="平台控制台" subtitle="平台方管理員登入">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={label}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={input} {...focusRing} />
        </div>
        <div>
          <label style={label}>密碼</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
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
          {submitting ? '登入中…' : '登入'}
        </button>
        <Link
          href="/admin/forgot-password"
          style={{ textAlign: 'center', fontSize: 13, color: C.muted, textDecoration: 'none' }}
        >
          忘記密碼？
        </Link>
      </form>
    </AuthShell>
  );
}
