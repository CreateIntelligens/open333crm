'use client';

/**
 * 核銷台登入（mobile-prototype-spec 2.2）。
 * 門市帳號＋密碼，保持登入預設勾選。帳號不存在與密碼錯誤是同一則訊息（後端也不區分，避免探測帳號）。
 */
import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStoreName, storeLogin, type LoginResponse } from '@/lib/store-console-api';
import { useCountdown } from '@/hooks/useStoreConsole';
import { classifyError, LOGIN_BANNER_TEXT, NETWORK_TEXT, type AccountErrorCode, type LoginBanner } from './errors';
import { mss } from './format';
import { Button, Page } from './ui';

interface Props {
  storeId: string | null;
  /** 前一次的錯誤帶入的橫幅（登入已過期、密碼已更改、此裝置已被登出） */
  banner?: LoginBanner;
  onLoggedIn: (res: LoginResponse, remember: boolean) => void;
  /** 登入時帳號停用或門市停業：切到狀態卡 */
  onAccountError: (code: AccountErrorCode, username: string) => void;
}

export function LoginScreen({ storeId, banner: initialBanner, onLoggedIn, onAccountError }: Props) {
  const [storeName, setStoreName] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [banner, setBanner] = useState<LoginBanner | undefined>(initialBanner);
  const [message, setMessage] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const remaining = useCountdown(lockedUntil);
  const locked = lockedUntil != null && remaining > 0;

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    getStoreName(storeId)
      .then((name) => {
        if (!cancelled) setStoreName(name);
      })
      .catch(() => {
        // 查無門市或網路錯誤：登入頁不顯示門市名稱即可，登入後會顯示帳號所屬的門市
      });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const invalid = banner === 'error';

  const edit = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    // 開始修改帳號或密碼就清除錯誤
    if (banner === 'error') setBanner(undefined);
    setMessage(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || locked) return;
    const name = username.trim();
    if (!name || !password) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await storeLogin({ username: name, password, remember });
      onLoggedIn(res, remember);
    } catch (err) {
      const c = classifyError(err);
      setBanner(undefined);
      if (c.kind === 'invalidCredentials') setBanner('error');
      else if (c.kind === 'locked') setLockedUntil(c.lockedUntil);
      else if (c.kind === 'account') onAccountError(c.code, name);
      else if (c.kind === 'network') setMessage(NETWORK_TEXT);
      else setMessage(c.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = (bad: boolean) =>
    cn(
      'h-12 w-full rounded-xl border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      bad ? 'border-destructive' : 'border-border',
    );

  return (
    <Page>
      <form onSubmit={submit} noValidate className="flex min-h-[100dvh] flex-col px-6 pb-[max(16px,env(safe-area-inset-bottom))] pt-16">
        {storeName && <p className="text-sm font-bold text-muted-foreground">{storeName}</p>}
        <h1 className="mt-2 text-4xl font-black tracking-tight text-foreground">核銷台</h1>
        <p className="mt-3 text-base text-muted-foreground">請用門市帳號登入，同一門市的店員共用這組帳號。</p>

        {banner && (
          <p
            role={banner === 'error' ? 'alert' : 'status'}
            className={cn(
              'mt-6 rounded-xl px-4 py-3 text-sm font-medium',
              banner === 'error' ? 'bg-destructive-subtle text-destructive' : 'bg-primary-subtle text-foreground',
            )}
          >
            {LOGIN_BANNER_TEXT[banner]}
          </p>
        )}
        {locked && (
          <p role="alert" className="mt-6 rounded-xl bg-destructive-subtle px-4 py-3 text-sm font-medium text-destructive">
            密碼錯誤次數過多，帳號暫時鎖定。請於 {mss(remaining)} 後再試，或聯絡店長。
          </p>
        )}
        {message && (
          <p role="alert" className="mt-6 rounded-xl bg-destructive-subtle px-4 py-3 text-sm font-medium text-destructive">
            {message}
          </p>
        )}

        <div className="mt-8 space-y-5">
          <div>
            <label htmlFor="store-username" className="mb-2 block text-sm font-bold text-muted-foreground">
              門市帳號
            </label>
            <input
              id="store-username"
              name="username"
              value={username}
              onChange={edit(setUsername)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={invalid}
              className={inputClass(invalid)}
            />
          </div>
          <div>
            <label htmlFor="store-password" className="mb-2 block text-sm font-bold text-muted-foreground">
              密碼
            </label>
            <div className="relative">
              <input
                id="store-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={edit(setPassword)}
                autoComplete="current-password"
                aria-invalid={invalid}
                className={cn(inputClass(invalid), 'pr-12')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
              </button>
            </div>
          </div>
          <label className="flex min-h-[44px] w-fit cursor-pointer items-center gap-3 text-base text-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-5 w-5 rounded accent-[hsl(var(--primary))]"
            />
            保持登入
          </label>
        </div>

        <div className="mt-auto space-y-4 pt-10">
          <Button type="submit" disabled={submitting || locked} aria-busy={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {locked ? `請於 ${mss(remaining)} 後再試` : submitting ? '登入中…' : '登入'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">忘記密碼請聯絡店長</p>
        </div>
      </form>
    </Page>
  );
}
