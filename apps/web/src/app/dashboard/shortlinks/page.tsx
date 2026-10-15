'use client';

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { AddIcon, CopyIcon, DeleteIcon, OpenInNewIcon, QrcodeIcon } from '@/components/icons/figma-icons';
import { useShortLinks } from '@/hooks/useShortLinks';
import { ClickStatsView } from '@/components/shortlink/ClickStatsView';
import { QrCodeDialog } from '@/components/shortlink/QrCodeDialog';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';

// 欄寬依 Figma 10.1.1 連結管理：標題 150、短網址 150、目標 URL 彈性、數字與狀態各 102、操作置中
const COLS = 'grid grid-cols-[150px_150px_minmax(0,1fr)_102px_102px_102px_102px_200px] items-center gap-4 px-5';

function LinkList() {
  const router = useRouter();
  const { links, isLoading, mutate } = useShortLinks();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLinkId, setQrLinkId] = useState<string | null>(null);
  const [qrTitle, setQrTitle] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin.replace(/^http:\/\/localhost:3000$/, 'http://localhost')
    : '';

  const handleCopy = (slug: string) => {
    const url = `${baseUrl}/s/${slug}`;
    navigator.clipboard.writeText(url);
    setCopied(slug);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除此短連結？')) return;
    try {
      await api.delete(`/shortlinks/${id}`);
      mutate();
    } catch (err) {
      console.error('Delete error:', err);
      alert(getApiErrorMessage(err, '刪除短連結失敗，請稍後重試'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div role="table" aria-label="短連結列表" className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[1180px]">
          <div role="row" className={`${COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
            <span role="columnheader">標題</span>
            <span role="columnheader">短網址</span>
            <span role="columnheader">目標 URL</span>
            <span role="columnheader">總點擊</span>
            <span role="columnheader">唯一</span>
            <span role="columnheader">狀態</span>
            <span role="columnheader">到期</span>
            <span role="columnheader" className="text-center">操作</span>
          </div>

          {links.map((l: Record<string, unknown>) => {
            const isExpired = Boolean(l.expiresAt && new Date(l.expiresAt as string) < new Date());
            const isActive = Boolean(l.isActive) && !isExpired;
            const slug = l.slug as string;
            const targetUrl = l.targetUrl as string;
            return (
              <div
                key={l.id as string}
                role="row"
                className={`${COLS} min-h-20 border-b border-border bg-background py-5 text-sm font-medium leading-5 text-muted-foreground transition-colors last:border-b-0 hover:bg-shell`}
              >
                <span role="cell" className="truncate">{(l.title as string) || '-'}</span>
                <span role="cell">
                  <span className="inline-flex items-center rounded-lg border border-border bg-muted px-[9px] py-px font-mono text-[10px] leading-[15px] text-muted-foreground">
                    /s/{slug}
                  </span>
                </span>
                <span role="cell" className="min-w-0">
                  {/* 只有 http(s) 網址才做成連結，避免 javascript: 之類的網址被點擊執行 */}
                  {isHttpUrl(targetUrl) ? (
                    <a
                      href={targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={targetUrl}
                      className="block truncate hover:text-primary"
                    >
                      {targetUrl}
                    </a>
                  ) : (
                    <span className="block truncate" title={targetUrl}>{targetUrl}</span>
                  )}
                </span>
                <span role="cell" className="tabular-nums">{l.totalClicks as number}</span>
                <span role="cell" className="tabular-nums">{l.uniqueClicks as number}</span>
                <span role="cell">
                  <span
                    className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium leading-4 ${
                      isActive ? 'bg-primary text-white' : 'border border-control-disabled bg-shell text-tertiary-foreground'
                    }`}
                  >
                    {isActive ? '啟用' : isExpired ? '已過期' : '停用'}
                  </span>
                </span>
                <span role="cell" className="tabular-nums">
                  {l.expiresAt ? new Date(l.expiresAt as string).toLocaleDateString('zh-TW') : '-'}
                </span>
                <span role="cell" className="flex items-center justify-center gap-7 text-tertiary-foreground">
                  <IconAction label={copied === slug ? '已複製' : '複製短網址'} onClick={() => handleCopy(slug)}>
                    {copied === slug ? <Check className="h-4 w-4 text-success" /> : <CopyIcon className="h-5 w-5" />}
                  </IconAction>
                  <IconAction
                    label="QR Code"
                    onClick={() => { setQrLinkId(l.id as string); setQrTitle((l.title || slug) as string); setQrOpen(true); }}
                  >
                    <QrcodeIcon className="h-5 w-5" />
                  </IconAction>
                  {/* Figma 這個位置用「open in new」圖示，功能沿用原本的「編輯」 */}
                  <IconAction label="編輯" onClick={() => router.push(`/dashboard/shortlinks/links/${l.id as string}/edit`)}>
                    <OpenInNewIcon className="h-5 w-5" />
                  </IconAction>
                  <IconAction label="刪除" onClick={() => handleDelete(l.id as string)} className="text-destructive">
                    <DeleteIcon className="h-5 w-5" />
                  </IconAction>
                </span>
              </div>
            );
          })}

          {links.length === 0 && (
            <div role="row" className="px-5 py-10 text-center text-sm text-muted-foreground">
              <span role="cell">尚無短連結，點擊「建立連結」開始</span>
            </div>
          )}
        </div>
      </div>

      <QrCodeDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        linkId={qrLinkId}
        linkTitle={qrTitle}
      />
    </>
  );
}

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function IconAction({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-5 w-5 items-center justify-center rounded hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

export default function ShortLinksPage() {
  const router = useRouter();
  const section = usePathname().split('/').at(-1);
  const tab = section === 'stats' ? 'stats' : 'links';

  return (
    <div className="flex flex-1 flex-col">
      {/* 說明文字：Figma 10.1.1 的說明是從渠道頁複製過來的佔位文字，這裡改成短連結的說明 */}
      <Topbar title="短連結" description={tab === 'links' ? '建立短網址並追蹤每個連結的點擊' : '查看短連結的點擊統計'}>
        {tab === 'links' && (
          <Button size="lg" className="w-[140px]" onClick={() => router.push('/dashboard/shortlinks/links/new')}>
            <AddIcon />
            建立連結
          </Button>
        )}
      </Topbar>
      <div className="flex-1 overflow-auto px-8 pb-8">
        <Tabs value={tab} onValueChange={() => undefined}>
          <TabsContent value="links">
            <LinkList />
          </TabsContent>
          <TabsContent value="stats">
            <ClickStatsView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
