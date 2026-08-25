'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import axios from 'axios';
import { API_BASE_URL } from '@/lib/constants';

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');
  const [state, setState] = useState<'loading' | 'ok' | 'expired' | 'inuse' | 'error'>('loading');
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    axios
      .get(`${API_BASE_URL}/trial/verify`, { params: { token } })
      .then((res) => {
        setSiteName(res.data.data.siteName);
        setState('ok');
      })
      .catch((err) => {
        const code = err?.response?.data?.error?.code;
        if (code === 'TRIAL_TOKEN_EXPIRED' || code === 'TRIAL_TOKEN_INVALID') setState('expired');
        else if (code === 'EMAIL_IN_USE') setState('inuse');
        else setState('error');
      });
  }, [token]);

  return (
    <div style={wrap}>
      <div style={card}>
        {state === 'loading' && <p style={{ fontSize: 15 }}>驗證中…</p>}
        {state === 'ok' && (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>站台已開通 🎉</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>
              「{siteName}」已開通完成，使用您申請時的 email 與密碼即可登入。
            </p>
            <button onClick={() => router.push('/login')} style={btn}>
              前往登入
            </button>
          </>
        )}
        {state === 'expired' && (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>連結已失效或過期</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>請重新申請，或於申請頁要求重寄驗證信。</p>
            <button onClick={() => router.push('/trial')} style={btn}>
              重新申請
            </button>
          </>
        )}
        {state === 'inuse' && (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>此 email 已被使用</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>此 email 已註冊過帳號，無法再開通試用站台。</p>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>驗證失敗</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>連結無效，請重新申請。</p>
            <button onClick={() => router.push('/trial')} style={btn}>
              前往申請
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d9488', fontFamily: 'system-ui, sans-serif' };
const card: React.CSSProperties = { background: '#fff', padding: 32, borderRadius: 12, width: 380, boxShadow: '0 8px 30px rgba(0,0,0,.2)', textAlign: 'center' as const };
const btn: React.CSSProperties = { marginTop: 16, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
