'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { LOGIN_CAPTCHA_ENABLED } from '@/lib/constants';
import 'playcaptcha/clawcaptcha.css';

// 夾娃娃機小遊戲關卡使用瀏覽器 API，僅在 client 端載入以避免 SSR 錯誤。
const ClawCaptcha = dynamic(
  () => import('playcaptcha').then((m) => m.ClawCaptcha),
  { ssr: false },
);

function LoginForm() {
  const { login, agent, isLoading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('admin@demo.com');
  const [password, setPassword] = useState('admin123');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 停用 CAPTCHA 時初始即視為已通過；啟用時需先完成夾娃娃機小遊戲。
  // 登入失敗不會重置此狀態，避免使用者因打錯密碼被迫重玩。
  const [captchaVerified, setCaptchaVerified] = useState(!LOGIN_CAPTCHA_ENABLED);

  // If already logged in, redirect
  useEffect(() => {
    if (!isLoading && agent) {
      router.push('/dashboard/inbox');
    }
  }, [isLoading, agent, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (LOGIN_CAPTCHA_ENABLED && !captchaVerified) {
      setError('請先完成夾娃娃機小遊戲以繼續登入。');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      await login(email, password, rememberMe);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || '登入失敗，請確認您的帳號密碼。');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">載入中...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">
            O3
          </div>
          <CardTitle className="text-2xl">open333CRM</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            登入您的帳號
          </p>
        </CardHeader>
        <CardContent>
          {/* CAPTCHA 置於 form 之外：小遊戲內部按鈕無 type，避免誤觸表單提交 */}
          {LOGIN_CAPTCHA_ENABLED && !captchaVerified && (
            <div className="mb-4">
              <ClawCaptcha onVerify={() => setCaptchaVerified(true)} />
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">電子郵件</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">密碼</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入密碼"
                required
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="rememberMe"
                checked={rememberMe}
                onCheckedChange={(checked: boolean) => setRememberMe(checked)}
              />
              <label htmlFor="rememberMe" className="text-sm cursor-pointer select-none">
                記住我
              </label>
            </div>
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !captchaVerified}
            >
              {submitting ? '登入中...' : !captchaVerified ? '請先完成小遊戲' : '登入'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            還沒有帳號？{' '}
            <a href="/trial" className="text-primary underline">
              免費試用
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <LoginForm />
    </AuthProvider>
  );
}
