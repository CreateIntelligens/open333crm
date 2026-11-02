'use client';

/**
 * 試用驗證頁：先確認連結（不開通），再讓本人設定管理員密碼與確認站台名稱，送出後才開通。
 * 申請時不收密碼（AUDIT TRIAL-05）：密碼只能由打開驗證信的人設定。
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import axios from 'axios';
import { API_BASE_URL } from '@/lib/constants';

type State = 'loading' | 'form' | 'ok' | 'already' | 'expired' | 'inuse' | 'error';

interface ApiError {
  response?: { data?: { error?: { code?: string; message?: string; details?: { issues?: Array<{ message?: string }> } } } };
}

/** 連結本身失效（不是表單填錯）的錯誤碼 → 對應的畫面 */
function linkState(code: string | undefined): State | null {
  if (code === 'TRIAL_TOKEN_EXPIRED' || code === 'TRIAL_TOKEN_INVALID') return 'expired';
  if (code === 'EMAIL_IN_USE') return 'inuse';
  return null;
}

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');
  const [state, setState] = useState<State>('loading');
  const [email, setEmail] = useState('');
  const [siteName, setSiteName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    axios
      .get(`${API_BASE_URL}/trial/verify`, { params: { token } })
      .then((res) => {
        const data = res.data.data as { email: string; siteName: string; status: 'pending' | 'provisioned' };
        setEmail(data.email);
        setSiteName(data.siteName);
        setState(data.status === 'provisioned' ? 'already' : 'form');
      })
      .catch((err: ApiError) => {
        setState(linkState(err?.response?.data?.error?.code) ?? 'error');
      });
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (password.length < 8) {
      setFormError('密碼至少需要 8 個字元。');
      return;
    }
    if (password !== confirm) {
      setFormError('兩次輸入的密碼不一致。');
      return;
    }
    if (!siteName.trim()) {
      setFormError('請輸入站台名稱。');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/trial/verify`, { token, password, siteName: siteName.trim() });
      const data = res.data.data as { siteName: string; alreadyProvisioned: boolean };
      setSiteName(data.siteName);
      setState(data.alreadyProvisioned ? 'already' : 'ok');
    } catch (err: unknown) {
      const error = (err as ApiError)?.response?.data?.error;
      const next = linkState(error?.code);
      if (next) {
        setState(next);
      } else if (error?.code === 'VALIDATION_ERROR') {
        setFormError(error.details?.issues?.[0]?.message ?? error.message ?? '輸入內容有誤，請檢查後重新送出。');
      } else if (error?.code === 'TRIAL_IN_PROGRESS') {
        setFormError('開通處理中，請稍候幾秒再按一次。');
      } else {
        setFormError(error?.message ?? '開通失敗，請稍後再試。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={card}>
        {state === 'loading' && <p style={{ fontSize: 15, textAlign: 'center' }}>確認驗證連結中…</p>}
        {state === 'form' && (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>設定管理員密碼</h1>
            <p style={{ color: '#66707f', fontSize: 13, marginBottom: 20 }}>
              email 已驗證。設定 <strong>{email}</strong> 的登入密碼，並確認站台名稱，送出後立即開通。
            </p>
            <form onSubmit={submit}>
              <label style={label}>站台名稱</label>
              <input required maxLength={100} value={siteName} onChange={(e) => setSiteName(e.target.value)} style={inp} />
              <label style={label}>設定密碼（至少 8 碼）</label>
              <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
              <label style={label}>再次輸入密碼</label>
              <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inp} />
              {formError && (
                <div role="alert" style={{ color: '#d1443e', fontSize: 13, marginBottom: 12 }}>
                  {formError}
                </div>
              )}
              <button type="submit" disabled={submitting} style={{ ...btn, width: '100%', marginTop: 4 }}>
                {submitting ? '開通中…' : '設定密碼並開通'}
              </button>
            </form>
          </>
        )}
        {state === 'ok' && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>站台已開通</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>
              「{siteName}」已開通完成，使用此 email 與剛才設定的密碼即可登入。
            </p>
            <button onClick={() => router.push('/login')} style={btn}>
              前往登入
            </button>
          </div>
        )}
        {state === 'already' && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>站台已開通</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>
              「{siteName}」已經開通過了，請以第一次設定的密碼登入。
            </p>
            <button onClick={() => router.push('/login')} style={btn}>
              前往登入
            </button>
          </div>
        )}
        {state === 'expired' && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>連結已失效或過期</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>請重新申請，或於申請頁要求重寄驗證信。</p>
            <button onClick={() => router.push('/trial')} style={btn}>
              重新申請
            </button>
          </div>
        )}
        {state === 'inuse' && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>此 email 已被使用</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>此 email 已註冊過帳號，無法再開通試用站台。</p>
          </div>
        )}
        {state === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>驗證失敗</h1>
            <p style={{ color: '#66707f', fontSize: 14 }}>連結無效或暫時無法確認，請稍後再試，或重新申請。</p>
            <button onClick={() => router.push('/trial')} style={btn}>
              前往申請
            </button>
          </div>
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
const card: React.CSSProperties = { background: '#fff', padding: 32, borderRadius: 12, width: 380, boxShadow: '0 8px 30px rgba(0,0,0,.2)' };
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, display: 'block' };
const inp: React.CSSProperties = { width: '100%', border: '1px solid #e3e8ef', borderRadius: 8, padding: '9px 11px', fontSize: 14, marginTop: 4, marginBottom: 14, boxSizing: 'border-box' };
const btn: React.CSSProperties = { marginTop: 16, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
