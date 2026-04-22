'use client';

import React, { useState, useEffect } from 'react';
import {
  Loader2,
  Plus,
  CheckCircle,
  XCircle,
  Trash2,
  Pencil,
  Copy,
  Check,
  Settings,
  Globe,
  Bot,
  Eye,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { useChannels } from '@/hooks/useChannels';
import { useWebchat } from '@/hooks/useWebchat';
import { ChannelFormDialog } from './ChannelFormDialog';
import { ChannelWizard } from './ChannelWizard';
import { BotConfigForm } from './BotConfigForm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const WEBHOOK_BASE_URL_KEY = 'open333crm_webhook_base_url';

interface Channel {
  id: string;
  channelType: string;
  displayName: string;
  isActive: boolean;
  webhookUrl?: string;
  lastVerifiedAt?: string;
  settings?: Record<string, unknown>;
  createdAt: string;
}

export function ChannelManagement() {
  const { channels, isLoading, mutate } = useChannels();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    Record<string, { success: boolean; message?: string }>
  >({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [botConfigChannel, setBotConfigChannel] = useState<Channel | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [embedCodeDialog, setEmbedCodeDialog] = useState<{ open: boolean; code: string }>({ open: false, code: '' });
  const [channelStatuses, setChannelStatuses] = useState<Record<string, { tokenWarning?: string }>>({});
  const [previewChannelId, setPreviewChannelId] = useState<string | null>(null);

  const { load: loadWidget, unload: unloadWidget } = useWebchat();

  // Webhook base URL state
  const [webhookBaseUrl, setWebhookBaseUrl] = useState('');
  const [webhookBaseUrlInput, setWebhookBaseUrlInput] = useState('');
  const [updatingBaseUrl, setUpdatingBaseUrl] = useState(false);
  const [baseUrlSaved, setBaseUrlSaved] = useState(false);

  // Load webhook base URL from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(WEBHOOK_BASE_URL_KEY) || '';
    setWebhookBaseUrl(saved);
    setWebhookBaseUrlInput(saved);
  }, []);

  const handleSaveBaseUrl = async () => {
    const cleanUrl = webhookBaseUrlInput.replace(/\/+$/, '');
    setUpdatingBaseUrl(true);
    setBaseUrlSaved(false);

    try {
      // Update all channels' webhook URLs on the server
      await api.post('/channels/webhook-base-url', { baseUrl: cleanUrl });

      // Save to localStorage
      localStorage.setItem(WEBHOOK_BASE_URL_KEY, cleanUrl);
      setWebhookBaseUrl(cleanUrl);
      setBaseUrlSaved(true);
      setTimeout(() => setBaseUrlSaved(false), 2000);

      // Refresh channel list
      mutate();
    } catch (err) {
      console.error('Failed to update webhook base URL:', err);
    } finally {
      setUpdatingBaseUrl(false);
    }
  };

  const handleVerify = async (channelId: string) => {
    setVerifying(channelId);
    setVerifyResult((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });

    try {
      await api.post(`/channels/${channelId}/verify`);
      setVerifyResult((prev) => ({
        ...prev,
        [channelId]: { success: true },
      }));
      mutate();
    } catch (err: any) {
      setVerifyResult((prev) => ({
        ...prev,
        [channelId]: {
          success: false,
          message:
            err.response?.data?.error?.message || '連線失敗',
        },
      }));
    } finally {
      setVerifying(null);
    }
  };

  const handleDelete = async (channelId: string) => {
    if (!confirm('確定要刪除此渠道嗎？此操作無法復原。')) { return; }
    try {
      await api.delete(`/channels/${channelId}`);
      mutate();
    } catch (err) {
      console.error('Failed to delete channel:', err);
    }
  };

  const handleCopyWebhook = (channelId: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(channelId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShowEmbedCode = async (channelId: string) => {
    try {
      const res = await api.get(`/channels/${channelId}/embed-code`);
      setEmbedCodeDialog({ open: true, code: res.data?.data?.html || '' });
    } catch {
      setEmbedCodeDialog({ open: true, code: '無法取得嵌入碼' });
    }
  };

  const handlePreviewWidget = (channelId: string) => {
    if (previewChannelId === channelId) {
      // Toggle off
      unloadWidget();
      setPreviewChannelId(null);
    } else {
      loadWidget(channelId);
      setPreviewChannelId(channelId);
    }
  };

  // Load FB token status for FB channels
  useEffect(() => {
    if (!channels || channels.length === 0) { return; }
    const fbChannels = (channels as Channel[]).filter((ch) => ch.channelType === 'FB');
    for (const ch of fbChannels) {
      api.get(`/channels/${ch.id}/status`).then((res) => {
        const tokenStatus = res.data?.data?.tokenStatus;
        if (tokenStatus?.warning) {
          setChannelStatuses((prev) => ({
            ...prev,
            [ch.id]: { tokenWarning: tokenStatus.warning },
          }));
        }
      }).catch(() => {});
    }
  }, [channels]);

  return (
    <div className="mt-4 space-y-6">
      {/* Webhook Base URL Setting */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Globe className="mt-0.5 h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 space-y-2">
              <div>
                <p className="font-medium text-sm">Webhook 公開網址</p>
                <p className="text-xs text-muted-foreground">
                  填入 ngrok 或其他隧道工具產生的公開網址，系統會自動更新所有渠道的 Webhook URL
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={webhookBaseUrlInput}
                  onChange={(e) => setWebhookBaseUrlInput(e.target.value)}
                  placeholder="例：https://xxxx.ngrok-free.app"
                  className="font-mono text-sm"
                />
                <Button
                  size="sm"
                  onClick={handleSaveBaseUrl}
                  disabled={updatingBaseUrl || !webhookBaseUrlInput}
                  className="shrink-0"
                >
                  {updatingBaseUrl ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : baseUrlSaved ? (
                    <>
                      <Check className="mr-1 h-4 w-4 text-green-500" />
                      已更新
                    </>
                  ) : (
                    '套用'
                  )}
                </Button>
              </div>
              {webhookBaseUrl && (
                <p className="text-xs text-green-600">
                  目前使用：{webhookBaseUrl}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Channel List Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">渠道管理</h2>
          <p className="text-sm text-muted-foreground">
            管理您的訊息渠道連線
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowWizard(true)}>
            設定精靈
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-1 h-4 w-4" />
            新增渠道
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<Settings className="h-12 w-12" />}
          title="沒有渠道"
          description="新增您的第一個渠道以開始接收訊息"
          action={
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-1 h-4 w-4" /> 新增渠道
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {(channels as Channel[]).map((ch) => (
            <Card key={ch.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Channel info */}
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="mt-0.5">
                      <ChannelBadge channel={ch.channelType} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{ch.displayName}</p>

                      {/* Webhook URL */}
                      {ch.webhookUrl && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground truncate max-w-[400px] font-mono">
                            {ch.webhookUrl}
                          </span>
                          <button
                            onClick={() =>
                              handleCopyWebhook(ch.id, ch.webhookUrl!)
                            }
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            {copiedId === ch.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      )}

                      {/* Last verified */}
                      {ch.lastVerifiedAt && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          最後驗證:{' '}
                          {new Date(ch.lastVerifiedAt).toLocaleString('zh-TW')}
                        </p>
                      )}

                      {/* FB Token warning */}
                      {channelStatuses[ch.id]?.tokenWarning && (
                        <p className="mt-0.5 text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                          {channelStatuses[ch.id].tokenWarning}
                        </p>
                      )}

                      {/* WebChat embed button */}
                      {ch.channelType === 'WEBCHAT' && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <Button
                            size="sm"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            onClick={() => handleShowEmbedCode(ch.id)}
                          >
                            取得嵌入碼
                          </Button>
                          <Button
                            size="sm"
                            variant={previewChannelId === ch.id ? 'default' : 'outline'}
                            className="h-6 px-2 text-xs gap-1"
                            onClick={() => handlePreviewWidget(ch.id)}
                          >
                            <Eye className="h-3 w-3" />
                            {previewChannelId === ch.id ? '關閉預覽' : '預覽'}
                          </Button>
                        </div>
                      )}

                      {/* Verify result message */}
                      {verifyResult[ch.id] && !verifyResult[ch.id].success && (
                        <p className="mt-1 text-xs text-destructive">
                          {verifyResult[ch.id].message}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={ch.isActive ? 'default' : 'secondary'}>
                      {ch.isActive ? '啟用' : '停用'}
                    </Badge>

                    {verifyResult[ch.id]?.success && (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    )}
                    {verifyResult[ch.id] &&
                      !verifyResult[ch.id].success && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleVerify(ch.id)}
                      disabled={verifying === ch.id}
                    >
                      {verifying === ch.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        '測試連線'
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBotConfigChannel(ch)}
                      title="Bot 設定"
                    >
                      <Bot className="h-4 w-4" />
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingChannel(ch)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(ch.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Channel Dialog */}
      <ChannelFormDialog
        open={showAddDialog || !!editingChannel}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false);
            setEditingChannel(null);
          }
        }}
        channel={editingChannel}
        webhookBaseUrl={webhookBaseUrl}
        onSaved={() => {
          setShowAddDialog(false);
          setEditingChannel(null);
          mutate();
        }}
      />

      {/* Channel Setup Wizard */}
      <ChannelWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        webhookBaseUrl={webhookBaseUrl}
        onComplete={() => mutate()}
      />

      {/* Bot Config Dialog */}
      <BotConfigForm
        open={!!botConfigChannel}
        onOpenChange={(v) => { if (!v) { setBotConfigChannel(null); } }}
        channel={botConfigChannel}
        onSaved={() => { setBotConfigChannel(null); mutate(); }}
      />

      {/* Embed Code Dialog */}
      <Dialog open={embedCodeDialog.open} onOpenChange={(v) => setEmbedCodeDialog({ ...embedCodeDialog, open: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WebChat 嵌入碼</DialogTitle>
          </DialogHeader>
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {embedCodeDialog.code}
          </pre>
          <p className="text-xs text-muted-foreground">
            將此程式碼貼入您網站的 {'<body>'} 標籤中即可啟用聊天功能。
          </p>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(embedCodeDialog.code);
              }}
            >
              <Copy className="mr-1 h-4 w-4" />
              複製
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
