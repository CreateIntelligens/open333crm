'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getPlatformToken, setPlatformToken, getMustChangePassword } from './lib/platform-api';

const NAV = [
  { href: '/admin/plans', label: '方案與上限' },
  { href: '/admin/tenants', label: '租戶管理' },
  { href: '/admin/usage', label: '用量統計' },
  { href: '/admin/plan-changes', label: '升級申請' },
  { href: '/admin/trial', label: '試用管理' },
  { href: '/admin/platform-users', label: '平台帳號' },
];

const PUBLIC_PATHS = ['/admin/login', '/admin/forgot-password', '/admin/reset-password'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const isPublicPage = PUBLIC_PATHS.includes(pathname ?? '');
  const isChangePasswordPage = pathname === '/admin/change-password';

  useEffect(() => {
    if (isPublicPage) {
      setReady(true);
      return;
    }
    if (!getPlatformToken()) {
      router.replace('/admin/login');
      return;
    }
    // 首次登入用系統寄的臨時密碼：mustChangePassword=true 時，除改密碼頁外一律攔截導向
    if (getMustChangePassword() && !isChangePasswordPage) {
      router.replace('/admin/change-password?forced=1');
      return;
    }
    setReady(true);
  }, [isPublicPage, isChangePasswordPage, router]);

  if (!ready) return null;
  if (isPublicPage) return <>{children}</>;

  // 強制改密碼模式：不顯示側邊欄/nav，避免繞過強制改密碼直接使用其他功能
  if (isChangePasswordPage && getMustChangePassword()) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: 'system-ui, sans-serif', padding: 28 }}>
        {children}
      </div>
    );
  }

  const navItem = (href: string, labelText: string) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        style={{
          padding: '10px 12px',
          borderRadius: 9,
          color: active ? '#fff' : 'rgba(255,255,255,.82)',
          textDecoration: 'none',
          background: active ? 'rgba(255,255,255,.20)' : 'transparent',
          fontWeight: active ? 600 : 500,
          fontSize: 14,
          transition: 'background .12s, color .12s',
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.10)';
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        {labelText}
      </Link>
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif' }}>
      <aside
        style={{
          width: 224,
          background: 'linear-gradient(180deg, #0d9488 0%, #0b7a70 100%)',
          color: '#fff',
          padding: '22px 16px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 24, padding: '0 4px', letterSpacing: '.01em' }}>
          平台控制台
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{NAV.map((n) => navItem(n.href, n.label))}</nav>

        <div style={{ marginTop: 'auto', paddingTop: 20 }}>
          <div style={{ height: 1, background: 'rgba(255,255,255,.15)', margin: '0 4px 14px' }} />
          {navItem('/admin/change-password', '修改密碼')}
          <button
            onClick={() => {
              setPlatformToken(null);
              router.replace('/admin/login');
            }}
            style={{
              marginTop: 8,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,.35)',
              color: '#fff',
              borderRadius: 9,
              padding: '9px 12px',
              cursor: 'pointer',
              width: '100%',
              fontSize: 13.5,
              fontWeight: 500,
              transition: 'background .12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.12)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            登出
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 32, background: '#f4f6f9', overflow: 'auto', minWidth: 0 }}>{children}</main>
    </div>
  );
}
