'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SWRConfig } from 'swr';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SocketProvider } from '@/providers/SocketProvider';
import { Sidebar, SectionNav } from '@/components/layout/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { SimulatorPanel } from '@/components/shared/SimulatorPanel';
import { WebTalkGlobal } from '@/components/webtalk/WebTalkGlobal';
import { WebMcpProvider } from '@/components/ai/WebMcpProvider';
import { Loader2 } from 'lucide-react';
import { PAGE_DIALOG_ROOT_ID } from '@/components/ui/page-dialog';

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { agent, isLoading } = useAuth();
  const router = useRouter();

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
      {/* 外框：#EEF1F5 底（shell token，設計師決定改為偏藍灰，與文字、框線色調一致），內容區白底、左上圓角 24、淡陰影 */}
      <div className="flex h-screen flex-col overflow-hidden bg-shell">
        <AppHeader />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <SectionNav />
          <main className="relative min-w-0 flex-1 overflow-hidden bg-background lg:rounded-tl-3xl lg:shadow-[0_0_2px_rgba(0,0,0,0.25)]">
            <div className="app-content h-full overflow-y-auto">{children}</div>
            {/* 「下一頁」式表單（PageDialog）會蓋在這裡，側欄與頂部列不動 */}
            <div id={PAGE_DIALOG_ROOT_ID} />
          </main>
        </div>
      </div>
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
