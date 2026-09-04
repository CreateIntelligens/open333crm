'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { platformApi, setMustChangePassword } from '../lib/platform-api';
import {
  C, card, pageTitle, pageDesc, sectionTitle, input, label, focusRing, btnPrimary, primaryHover, banner,
} from '../lib/ui';

function ChangePasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forced = searchParams.get('forced') === '1';
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg('');
    try {
      await platformApi.post('/auth/change-password', { oldPassword, newPassword });
      setMustChangePassword(false);
      if (forced) {
        router.replace('/admin/plans');
        return;
      }
      setMsgOk(true);
      setMsg('密碼已更新');
      setOldPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      setMsgOk(false);
      setMsg(
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          '修改失敗',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formInner = (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={label}>{forced ? '臨時密碼（開通信中提供）' : '目前密碼'}</label>
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
          style={input}
          {...focusRing}
        />
      </div>
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
      <button
        type="submit"
        disabled={submitting}
        style={{ ...btnPrimary, width: '100%', marginTop: 4, opacity: submitting ? 0.6 : 1 }}
        {...primaryHover}
      >
        {submitting ? '更新中…' : '更新密碼'}
      </button>
    </form>
  );

  // 強制模式：全螢幕置中卡片（layout 已隱藏側邊欄）
  if (forced) {
    return (
      <div style={{ minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ ...card, width: 380, padding: 30 }}>
          <h1 style={{ ...pageTitle, fontSize: 20 }}>設定新密碼</h1>
          <p style={pageDesc}>首次登入請先設定新密碼，完成後才能使用平台後台其他功能。</p>
          {msg && <div style={banner(msgOk)}>{msg}</div>}
          {formInner}
        </div>
      </div>
    );
  }

  // 一般模式：後台內頁
  return (
    <div style={{ maxWidth: 780 }}>
      <h1 style={pageTitle}>修改密碼</h1>
      <p style={pageDesc}>修改目前登入平台帳號的密碼。</p>
      {msg && <div style={banner(msgOk)}>{msg}</div>}
      <div style={{ ...card, maxWidth: 400 }}>
        <h2 style={sectionTitle}>變更密碼</h2>
        {formInner}
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordForm />
    </Suspense>
  );
}
