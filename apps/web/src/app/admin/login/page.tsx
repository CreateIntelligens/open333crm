'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { platformApi, setPlatformToken } from '../lib/platform-api';

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
      router.replace('/admin/plans');
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d9488',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={submit}
        style={{ background: '#fff', padding: 32, borderRadius: 12, width: 360, boxShadow: '0 8px 30px rgba(0,0,0,.2)' }}
      >
        <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>平台控制台</h1>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#66707f' }}>平台方 superuser 登入</p>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <label style={{ fontSize: 13, fontWeight: 600 }}>密碼</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        {error && <div style={{ color: '#d1443e', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            background: '#0d9488',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px',
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #e3e8ef',
  borderRadius: 8,
  padding: '9px 11px',
  fontSize: 14,
  marginTop: 4,
  marginBottom: 14,
  boxSizing: 'border-box',
};
