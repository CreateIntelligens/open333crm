'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface RegistrationInfo {
  channelType: string;
  channelLabel: string;
  profileName: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'form'; info: RegistrationInfo }
  | { kind: 'done'; status: string };

/** 與後端相同的格式（32 bytes base64url）；不符就不送請求，避免被組成其他 API 路徑 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVALID_LINK = '連結無法使用，請回到對話重新取得';

const RESULT: Record<string, { title: string; body: string }> = {
  registered: { title: '已登記您的 email', body: '結果也已傳到您的對話中，可以關閉此頁面。' },
  merged: {
    title: '已完成帳號整合',
    body: '使用相同 email 的其他帳號已整合為同一位顧客，對話紀錄會合併在一起。若非本人操作，請依對話中的說明於 7 天內解除。',
  },
  channel_conflict: {
    title: '無法自動整合帳號',
    body: '這個 email 已由同一類帳號中的另一個帳號使用。如需協助，請直接在對話中留言，客服會為您處理。',
  },
};

/**
 * 顧客的 email 登記頁（change add-email-identity-merge）。不需登入，以連結中的 token 作為憑證。
 * 對應 API：GET／POST /public/email-registration/:token
 */
export function EmailRegistrationForm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!TOKEN_PATTERN.test(token)) {
      setPhase({ kind: 'invalid', message: INVALID_LINK });
      return;
    }
    let cancelled = false;
    api
      .get(`/public/email-registration/${encodeURIComponent(token)}`)
      .then((res) => {
        if (!cancelled) setPhase({ kind: 'form', info: res.data.data as RegistrationInfo });
      })
      .catch((err) => {
        if (!cancelled) setPhase({ kind: 'invalid', message: getApiErrorMessage(err, INVALID_LINK) });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post(`/public/email-registration/${encodeURIComponent(token)}`, { email: email.trim() });
      setPhase({ kind: 'done', status: (res.data.data as { status: string }).status });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 410) setPhase({ kind: 'invalid', message: getApiErrorMessage(err, '連結已失效，請回到對話重新取得') });
      else setError(getApiErrorMessage(err, '送出失敗，請稍後再試'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-md rounded-2xl bg-background p-8 shadow-lg">
        {phase.kind === 'loading' && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {phase.kind === 'invalid' && (
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold">無法登記</h1>
            <p className="text-sm text-muted-foreground">{phase.message}</p>
          </div>
        )}

        {phase.kind === 'form' && (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">登記 email</h1>
              <p className="text-sm text-muted-foreground">
                登記後，使用相同 email 的其他帳號會整合為同一位顧客，對話紀錄會合併在一起。
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">要登記的帳號</p>
              <p className="mt-1 font-medium">{phase.info.channelLabel}</p>
              {phase.info.profileName && <p className="text-muted-foreground">{phase.info.profileName}</p>}
              <p className="mt-2 text-xs text-muted-foreground">如果這不是您的帳號，請不要送出，也不要把連結轉給別人。</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="registration-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="registration-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '送出中...' : '送出'}
            </Button>
          </form>
        )}

        {phase.kind === 'done' && (
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold">{RESULT[phase.status]?.title ?? '已送出'}</h1>
            <p className="text-sm text-muted-foreground">{RESULT[phase.status]?.body ?? '可以關閉此頁面。'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
