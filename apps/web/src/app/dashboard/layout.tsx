'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SocketProvider } from '@/providers/SocketProvider';
import { Sidebar, SectionNav, MobileNav } from '@/components/layout/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { SimulatorPanel } from '@/components/shared/SimulatorPanel';
import { WebTalkGlobal } from '@/components/webtalk/WebTalkGlobal';
import { WebMcpProvider } from '@/components/ai/WebMcpProvider';
import { Loader2 } from 'lucide-react';

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { agent, isLoading } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !agent) {
      router.push('/login');
    }
  }, [isLoading, agent, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!agent) {
    return null;
  }

  return (
    <SocketProvider>
      {/* 外框底色 #EEF1F5 取自設計稿；暗色模式退回一般背景 */}
      <div className="flex h-screen flex-col overflow-hidden bg-[#eef1f5] dark:bg-muted">
        <AppHeader onOpenMenu={() => setMenuOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <SectionNav />
          <main className="min-w-0 flex-1 overflow-y-auto bg-background lg:rounded-tl-2xl">{children}</main>
        </div>
      </div>
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <SimulatorPanel />
      <WebTalkGlobal />
      <WebMcpProvider />
    </SocketProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: false }}>
        <DashboardShell>{children}</DashboardShell>
      </SWRConfig>
    </AuthProvider>
  );
}
