'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Copy, QrCode, Loader2, ExternalLink } from 'lucide-react';
import { useShortLinks } from '@/hooks/useShortLinks';
import { LinkFormDialog } from '@/components/shortlink/LinkFormDialog';
import { ClickStatsView } from '@/components/shortlink/ClickStatsView';
import { QrCodeDialog } from '@/components/shortlink/QrCodeDialog';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';

function LinkList() {
  const { links, isLoading, mutate } = useShortLinks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLinkId, setQrLinkId] = useState<string | null>(null);
  const [qrTitle, setQrTitle] = useState('');
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.get('/tags').then((res) => {
      setTags((res.data.data || []).map((t: Record<string, unknown>) => ({ id: t.id as string, name: t.name as string })));
    }).catch(() => {});
  }, []);

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
    if (!confirm('確定刪除此短連結？')) { return; }
    try {
      await api.delete(`/shortlinks/${id}`);
      mutate();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditData(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> 建立連結
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3">標題</th>
                <th className="text-left p-3">短網址</th>
                <th className="text-left p-3">目標 URL</th>
                <th className="text-right p-3">總點擊</th>
                <th className="text-right p-3">唯一</th>
                <th className="text-center p-3">狀態</th>
                <th className="text-left p-3">到期</th>
                <th className="text-center p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l: Record<string, unknown>) => {
                const isExpired = l.expiresAt && new Date(l.expiresAt as string) < new Date();
                const isActive = l.isActive && !isExpired;
                return (
                  <tr key={l.id as string} className="border-t">
                    <td className="p-3 font-medium">{(l.title as string) || '-'}</td>
                    <td className="p-3">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/s/{l.slug as string}</code>
                    </td>
                    <td className="p-3 max-w-[200px] truncate text-muted-foreground">
                      {l.targetUrl as string}
                    </td>
                    <td className="p-3 text-right">{l.totalClicks as number}</td>
                    <td className="p-3 text-right">{l.uniqueClicks as number}</td>
                    <td className="p-3 text-center">
                      <Badge color={isActive ? '#22c55e' : '#ef4444'}>
                        {isActive ? '啟用' : isExpired ? '已過期' : '停用'}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {l.expiresAt ? new Date(l.expiresAt as string).toLocaleDateString('zh-TW') : '-'}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCopy(l.slug as string)}
                          title="複製 URL"
                        >
                          <Copy className={`h-3.5 w-3.5 ${copied === l.slug ? 'text-green-500' : ''}`} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setQrLinkId(l.id as string); setQrTitle((l.title || l.slug) as string); setQrOpen(true); }}
                          title="QR Code"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setEditData(l); setDialogOpen(true); }}
                          title="編輯"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleDelete(l.id as string)}
                          title="刪除"
                        >
                          &times;
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {links.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    尚無短連結，點擊「建立連結」開始
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <LinkFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => mutate()}
        editData={editData}
        tags={tags}
      />

      <QrCodeDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        linkId={qrLinkId}
        linkTitle={qrTitle}
      />
    </div>
  );
}

export default function ShortLinksPage() {
  const [tab, setTab] = useState('links');

  return (
    <div className="flex flex-1 flex-col">
      <Topbar title="短連結" />
      <div className="flex-1 overflow-auto p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="links">連結管理</TabsTrigger>
            <TabsTrigger value="stats">統計分析</TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="mt-4">
            <LinkList />
          </TabsContent>

          <TabsContent value="stats" className="mt-4">
            <ClickStatsView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
