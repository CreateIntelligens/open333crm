'use client';

import React, { useState, useEffect } from 'react';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Check,
  Copy,
  Settings,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { SettingsHeader } from './SettingsHeader';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/EmptyState';
import { useChannels } from '@/hooks/useChannels';
import { useWebchat } from '@/hooks/useWebchat';
import { ChannelFormDialog } from './ChannelFormDialog';
import { ChannelWizard } from './ChannelWizard';
import { BotConfigForm } from './BotConfigForm';
import { DownstreamWebhookDialog } from './DownstreamWebhookDialog';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { AddIcon, AutomationIcon, CopyIcon, DeleteIcon, EditIcon, WebhookIcon } from '@/components/icons/figma-icons';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { getApiErrorMessage } from '@/lib/api-error';
import { SettingsLoadError } from '@/components/knowledge/SettingsLoadError';
import { usePermission } from '@/providers/AuthProvider';
import { ChannelAccountRouting } from './ChannelAccountRouting';
import { META_CONNECT_ERROR_TEXT, MetaConnectButton, MetaConnectDialog, useMetaConnectConfigured } from './MetaConnect';

const WEBHOOK_BASE_URL_KEY = 'open333crm_webhook_base_url';

interface Channel {
  id: string;
  channelType: string;
  displayName: string;
  publicKey?: string | null;
  isActive: boolean;
  webhookUrl?: string;
  lastVerifiedAt?: string;
  /** FB 粉專 ID／IG 帳號 ID，webhook 依此分派（由驗證自動取得） */
  externalAccountId?: string | null;
  settings?: Record<string, unknown>;
  createdAt: string;
}

/**
 * 渠道列表讀取失敗時的說明（issue #411，RBAC-11）。
 * 403 不可顯示成「沒有渠道」：租戶可能有啟用中的渠道，只是角色或方案擋下了檢視權限。
 */
export function describeChannelListError(err: unknown): { forbidden: boolean; message: string } {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 403) {
    return {
      forbidden: true,
      message: '你沒有權限檢視渠道。需要「檢視渠道」權限，且目前的方案要包含渠道功能，請洽管理員。',
    };
  }
  return { forbidden: false, message: getApiErrorMessage(err, '無法讀取渠道列表，請稍後重試') };
}

export function ChannelManagement() {
  const { channels, isLoading, error: channelsError, mutate } = useChannels();
  const canCreateChannels = usePermission('channel.create');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const metaConnectConfigured = useMetaConnectConfigured();
  // Facebook 授權導回時帶 ?metaConnect=（選擇粉專）或 ?metaConnectError=（失敗原因）
  const [metaConnectId, setMetaConnectId] = useState<string | null>(null);
  const [metaConnectError, setMetaConnectError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('metaConnect');
    const error = params.get('metaConnectError');
    if (id) setMetaConnectId(id);
    if (error) setMetaConnectError(META_CONNECT_ERROR_TEXT[error] ?? 'Facebook 授權失敗，請稍後重試。');
    if (id || error) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<
    Record<string, { success: boolean; message?: string }>
  >({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [botConfigChannel, setBotConfigChannel] = useState<Channel | null>(null);
  const [downstreamChannel, setDownstreamChannel] = useState<Channel | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [embedCodeDialog, setEmbedCodeDialog] = useState<{ open: boolean; code: string }>({ open: false, code: '' });
  const [chatboxLinkDialog, setChatboxLinkDialog] = useState<{ open: boolean; url: string }>({ open: false, url: '' });
  const [channelStatuses, setChannelStatuses] = useState<Record<string, { tokenWarning?: string }>>({});
  const [previewChannelId, setPreviewChannelId] = useState<string | null>(null);
  const [themeChannel, setThemeChannel] = useState<Channel | null>(null);
  const [themeUrl, setThemeUrl] = useState('');
  const [themePosition, setThemePosition] = useState('center');
  const [themeSize, setThemeSize] = useState<'cover' | 'contain'>('cover');
  const [savingTheme, setSavingTheme] = useState(false);

  const { load: loadWidget, unload: unloadWidget } = useWebchat();
  // Webhook 公開網址會改寫全租戶每個渠道（含分店看不到的），後端只允許總店（issue #408）
  const canViewAllChannels = usePermission('channel.view_all');
  const canUpdateChannels = usePermission('channel.update');
  const canSetWebhookBaseUrl = canViewAllChannels && canUpdateChannels;
  const hasWebchatChannel = (channels as Channel[]).some((ch) => ch.channelType === CHANNEL_TYPE.WEBCHAT);

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
    const cleanUrl = webhookBaseUrlInput.trim().replace(/\/+$/, '');
    // 會改寫全租戶所有渠道的 webhook 網址，填錯所有渠道都收不到訊息（G08）
    const count = (channels as Channel[]).length;
    if (!confirm(
      `確定要套用「${cleanUrl}」嗎？\n\n` +
      `這會改寫全部 ${count} 個渠道的 Webhook 網址。網址填錯時，照新網址設定的渠道會收不到任何訊息。\n` +
      `套用後，請到 LINE／Meta 後台確認各渠道的 Webhook 網址。`,
    )) return;
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
      alert(getApiErrorMessage(err, 'Webhook 網址更新失敗，請稍後重試'));
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
    } catch (err) {
      setVerifyResult((prev) => ({
        ...prev,
        [channelId]: {
          success: false,
          message:
            getApiErrorMessage(err, '連線失敗'),
        },
      }));
    } finally {
      setVerifying(null);
    }
  };

  // 收過對話的渠道刪不掉（外鍵），改用停用；停用保留歷史資料、可隨時重新啟用（G15）
  const handleToggleActive = async (ch: Channel) => {
    const next = !ch.isActive;
    if (!next && !confirm(`確定要停用「${ch.displayName}」嗎？停用後此渠道不再收發訊息，歷史對話會保留，之後可以重新啟用。`)) return;
    try {
      await api.patch(`/channels/${ch.id}`, { isActive: next });
      mutate();
    } catch (err) {
      alert(getApiErrorMessage(err, next ? '啟用渠道失敗，請稍後重試' : '停用渠道失敗，請稍後重試'));
    }
  };

  const handleDelete = async (channelId: string) => {
    if (!confirm('確定要刪除此渠道嗎？此操作無法復原。收過對話的渠道無法刪除，請改用「停用」。')) return;
    try {
      await api.delete(`/channels/${channelId}`);
      mutate();
    } catch (err) {
      alert(getApiErrorMessage(err, '刪除渠道失敗，請稍後重試'));
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

  const getChatboxDomain = () => {
    const configured = webhookBaseUrl || webhookBaseUrlInput;
    return (configured || window.location.origin).replace(/\/+$/, '');
  };

  const handleShowChatboxLink = async (channel: Channel) => {
    try {
      const res = await api.post(`/channels/${channel.id}/chatbox-link`, {
        domain: getChatboxDomain(),
      });
      setChatboxLinkDialog({ open: true, url: res.data?.data?.url || '' });
      mutate();
    } catch {
      setChatboxLinkDialog({ open: true, url: '無法產生網頁版連結' });
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

  const openThemeDialog = (channel: Channel) => {
    const theme = ((channel.settings || {}).chatboxTheme || {}) as Record<string, unknown>;
    setThemeChannel(channel);
    setThemeUrl(typeof theme.backgroundImageUrl === 'string' ? theme.backgroundImageUrl : '');
    setThemePosition(typeof theme.backgroundPosition === 'string' ? theme.backgroundPosition : 'center');
    setThemeSize(theme.backgroundSize === 'contain' ? 'contain' : 'cover');
  };

  const saveTheme = async () => {
    if (!themeChannel) return;
    setSavingTheme(true);
    try {
      await api.patch(`/channels/${themeChannel.id}/chatbox-theme`, {
        backgroundSize: themeSize,
        backgroundPosition: themePosition || 'center',
      });
      setThemeChannel(null);
      mutate();
    } finally {
      setSavingTheme(false);
    }
  };

  const uploadThemeBackground = async (file: File) => {
    if (!themeChannel) return;
    setSavingTheme(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`/channels/${themeChannel.id}/chatbox-theme/background`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setThemeUrl(res.data?.data?.url || '');
      mutate();
    } finally {
      setSavingTheme(false);
    }
  };

  // Load FB token status for FB channels
  useEffect(() => {
    if (!channels || channels.length === 0) return;
    // 停用的渠道不查（G03）：權杖狀態對停用的渠道沒有意義
    const fbChannels = (channels as Channel[]).filter((ch) => ch.channelType === CHANNEL_TYPE.FB && ch.isActive);
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

  const webchatChannels = (channels as Channel[]).filter((ch) => ch.channelType === CHANNEL_TYPE.WEBCHAT);

  // 版面依 Figma「12.1.1 渠道管理」：上方 Webhook／WebChat 設定、下方渠道列表，兩區間距 48
  return (
    <div className="flex flex-col gap-12">
      {/* Webhook 公開網址＋WebChat 網頁版連結。
          公開網址會改寫全租戶每個渠道，只有總店（channel.view_all＋channel.update）看得到（issue #408，取自 main） */}
      {(canSetWebhookBaseUrl || hasWebchatChannel) && (
      <section className="flex flex-col gap-5">
        {canSetWebhookBaseUrl && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold leading-5 text-foreground">Webhook 公開網址</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              填入本系統對外的正式網域（https 開頭），系統會依此改寫所有渠道的 Webhook 網址。一般不需要修改，填錯會讓所有渠道收不到訊息。
            </p>
          </div>
          <div className="flex items-center gap-6">
            <input
              aria-label="Webhook 公開網址"
              value={webhookBaseUrlInput}
              onChange={(e) => setWebhookBaseUrlInput(e.target.value)}
              placeholder="例：https://crm.example.com"
              className="h-[42px] min-w-0 flex-1 rounded-lg border border-border bg-muted px-[13px] text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            <button
              type="button"
              onClick={handleSaveBaseUrl}
              disabled={updatingBaseUrl || !webhookBaseUrlInput}
              className="inline-flex h-9 w-[92px] flex-none items-center justify-center gap-1 rounded-md bg-primary text-sm font-semibold leading-5 text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updatingBaseUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : baseUrlSaved ? <><Check className="h-4 w-4" />已更新</> : '套用'}
            </button>
          </div>
          {webhookBaseUrl && <p className="text-xs text-success">目前使用：{webhookBaseUrl}</p>}
        </div>
        )}

        {webchatChannels.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-5 text-muted-foreground">WebChat 網頁版連結</p>
            {webchatChannels.map((ch) => (
              <div key={ch.id} className="flex items-center gap-6">
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-[13px] py-[9px]">
                  <p className="truncate text-sm font-bold leading-6 text-foreground">{ch.displayName}</p>
                  <p className="truncate text-sm leading-6 text-muted-foreground">
                    {ch.publicKey ? `${getChatboxDomain()}/chatbox?channel=${ch.publicKey}` : '尚未產生 publicKey'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleShowChatboxLink(ch)}
                  className="h-9 w-[92px] flex-none rounded-md border border-border bg-background text-sm font-medium leading-5 text-tertiary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ch.publicKey ? '複製連結' : '產生連結'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* 渠道列表 */}
      <section className="flex flex-col gap-7">
        {/* 依 Claude Design：標題＋說明在左，設定精靈／新增渠道在右（改用共用標題區與按鈕，尺寸跟著全站規範） */}
        <SettingsHeader title="渠道管理" description="管理您的訊息渠道連線">
          {/* 沒有 channel.create 時不顯示新增入口（取自 main；權限仍由後端把關） */}
          {canCreateChannels && (
            <>
              {metaConnectConfigured && <MetaConnectButton onError={setMetaConnectError} />}
              <Button variant="outline" size="lg" className="w-[140px]" onClick={() => setShowWizard(true)}>
                設定精靈
              </Button>
              <Button size="lg" className="w-[140px]" onClick={() => setShowAddDialog(true)}>
                <AddIcon />
                新增渠道
              </Button>
            </>
          )}
        </SettingsHeader>

        {metaConnectError && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-destructive-subtle p-3 text-sm text-destructive">
            <span>{metaConnectError}</span>
            <button type="button" className="shrink-0 underline" onClick={() => setMetaConnectError(null)}>關閉</button>
          </div>
        )}
        {metaConnectId && (
          <MetaConnectDialog connectId={metaConnectId} onClose={() => setMetaConnectId(null)} onConnected={() => mutate()} />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : channelsError ? (
          // 列表讀取失敗（403 顯示無權限、其他錯誤可重新載入），不顯示「沒有渠道」（issue #411，取自 main）
          <SettingsLoadError
            {...describeChannelListError(channelsError)}
            onRetry={() => mutate()}
          />
        ) : channels.length === 0 ? (
          <EmptyState
            icon={<Settings className="h-12 w-12" />}
            title="沒有渠道"
            description={canCreateChannels ? '新增您的第一個渠道以開始接收訊息' : '目前沒有你看得到的渠道'}
            action={canCreateChannels ? <Button onClick={() => setShowAddDialog(true)}><AddIcon /> 新增渠道</Button> : undefined}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-5 border-b border-border bg-muted px-5 py-2 text-sm font-medium leading-7 text-muted-foreground">
              <span className="w-[81px] flex-none">頻道</span>
              <span className="min-w-0 flex-1">頻道名稱 / Webhook URL</span>
              <span className="ml-4 flex w-[440px] flex-none gap-5">
                <span className="w-[49px]">狀態</span>
                <span>動作</span>
              </span>
            </div>
            {(channels as Channel[]).map((ch) => (
              <div key={ch.id} className="flex items-center gap-9 border-b border-border bg-background p-5 last:border-b-0">
                <div className="flex min-w-0 flex-1 items-start gap-5">
                  <div className="w-[81px] flex-none">
                    <ChannelTag type={ch.channelType} />
                  </div>
                  <div className="flex min-w-0 max-w-[471px] flex-1 flex-col gap-1">
                    <p className="truncate text-base font-semibold leading-5 text-foreground">{ch.displayName}</p>
                    <div className="flex flex-col gap-1">
                      {ch.webhookUrl && (
                        <div className="flex items-center gap-1">
                          <span className="min-w-0 max-w-[396px] truncate font-mono text-xs font-medium leading-5 text-muted-foreground">{ch.webhookUrl}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyWebhook(ch.id, ch.webhookUrl!)}
                            aria-label="複製 Webhook URL"
                            title="複製 Webhook URL"
                            className="flex h-5 w-5 flex-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {copiedId === ch.id ? <Check className="h-3.5 w-3.5 text-success" /> : <CopyIcon className="h-5 w-5" />}
                          </button>
                        </div>
                      )}
                      {ch.lastVerifiedAt && (
                        <p className="text-xs leading-5 text-muted-foreground">最後驗證：{new Date(ch.lastVerifiedAt).toLocaleString('zh-TW')}</p>
                      )}
                      <ChannelAccountRouting
                        channelType={ch.channelType}
                        externalAccountId={ch.externalAccountId}
                        settings={ch.settings}
                        isActive={ch.isActive}
                      />
                      {channelStatuses[ch.id]?.tokenWarning && (
                        <p className="text-xs font-medium text-warning">{channelStatuses[ch.id].tokenWarning}</p>
                      )}
                      {ch.channelType === CHANNEL_TYPE.WEBCHAT && (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => handleShowEmbedCode(ch.id)} className="text-xs font-medium leading-5 text-primary hover:text-primary-hover">
                            取得嵌入碼
                          </button>
                          <div className="flex items-center gap-1">
                            <Chip active={previewChannelId === ch.id} onClick={() => handlePreviewWidget(ch.id)}>
                              {previewChannelId === ch.id ? '關閉預覽' : '預覽'}
                            </Chip>
                            <Chip onClick={() => openThemeDialog(ch)}>背景</Chip>
                          </div>
                        </div>
                      )}
                      {verifyResult[ch.id] && !verifyResult[ch.id].success && (
                        <p className="text-xs text-destructive">{verifyResult[ch.id].message}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex w-[440px] flex-none items-center gap-5">
                  <span className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium leading-4 ${ch.isActive ? 'bg-primary text-white' : 'bg-shell text-tertiary-foreground'}`}>
                    {ch.isActive ? '啟用' : '停用'}
                  </span>
                  {/* 停用／啟用（取自 main；停用前會確認） */}
                  <button
                    type="button"
                    onClick={() => handleToggleActive(ch)}
                    className="inline-flex w-[60px] flex-none items-center justify-center rounded-md border border-border bg-background py-2 text-sm font-medium leading-5 text-tertiary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ch.isActive ? '停用' : '啟用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVerify(ch.id)}
                    disabled={verifying === ch.id}
                    className="inline-flex w-[93px] items-center justify-center gap-1 rounded-md border border-border bg-background py-2 pl-4 pr-3 text-sm font-medium leading-5 text-tertiary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {verifying === ch.id ? <Loader2 className="h-4 w-4 animate-spin" /> : verifyResult[ch.id]?.success ? <><CheckCircle className="h-3.5 w-3.5 text-success" />已連線</> : verifyResult[ch.id] ? <><XCircle className="h-3.5 w-3.5 text-destructive" />重試</> : '測試連線'}
                  </button>
                  <div className="flex items-center gap-7 text-tertiary-foreground">
                    <IconAction label="Bot 設定" onClick={() => setBotConfigChannel(ch)}><AutomationIcon className="h-5 w-5" /></IconAction>
                    <IconAction label="下游 Webhook 轉發" onClick={() => setDownstreamChannel(ch)}><WebhookIcon className="h-5 w-5" /></IconAction>
                    <IconAction label="編輯渠道" onClick={() => setEditingChannel(ch)}><EditIcon className="h-4 w-4" /></IconAction>
                    <IconAction label="刪除渠道" onClick={() => handleDelete(ch.id)} className="text-destructive"><DeleteIcon className="h-5 w-5" /></IconAction>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
        onOpenChange={(v) => { if (!v) setBotConfigChannel(null); }}
        channel={botConfigChannel}
        onSaved={() => { setBotConfigChannel(null); mutate(); }}
      />

      {/* Downstream Webhook Dialog (LINE) */}
      <DownstreamWebhookDialog
        open={!!downstreamChannel}
        onOpenChange={(v) => { if (!v) setDownstreamChannel(null); }}
        channel={downstreamChannel}
        onSaved={() => { setDownstreamChannel(null); mutate(); }}
      />

      {/* Embed Code Dialog */}
      <Dialog open={embedCodeDialog.open} onOpenChange={(v) => setEmbedCodeDialog({ ...embedCodeDialog, open: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>網站聊天室嵌入碼</DialogTitle>
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

      <Dialog open={chatboxLinkDialog.open} onOpenChange={(v) => setChatboxLinkDialog({ ...chatboxLinkDialog, open: v })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>網站聊天室網頁版連結</DialogTitle>
          </DialogHeader>
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {chatboxLinkDialog.url}
          </pre>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(chatboxLinkDialog.url);
              }}
            >
              <Copy className="mr-1 h-4 w-4" />
              複製
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!themeChannel} onOpenChange={(v) => { if (!v) setThemeChannel(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chatbox 背景</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">尺寸</label>
                <select
                  value={themeSize}
                  onChange={(event) => setThemeSize(event.target.value === 'contain' ? 'contain' : 'cover')}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">位置</label>
                <Input
                  value={themePosition}
                  onChange={(event) => setThemePosition(event.target.value)}
                  placeholder="center"
                  className="mt-1"
                />
              </div>
            </div>
            {themeUrl ? (
              <div className="h-36 rounded-md border bg-cover bg-center" style={{ backgroundImage: `url(${themeUrl})` }} />
            ) : null}
            <label className="block">
              <span className="text-sm font-medium">上傳背景圖片</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="mt-1 block w-full text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadThemeBackground(file);
                }}
              />
            </label>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setThemeChannel(null)}>
              取消
            </Button>
            <Button size="sm" onClick={saveTheme} disabled={savingTheme}>
              {savingTheme ? <Loader2 className="h-4 w-4 animate-spin" /> : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 依 Figma 的小元件 ────────────────────────────────────────

const CHANNEL_TAG: Record<string, { label: string; cls: string }> = {
  [CHANNEL_TYPE.FB]: { label: 'Facebook', cls: 'bg-primary-subtle text-primary' },
  [CHANNEL_TYPE.LINE]: { label: 'LINE', cls: 'bg-success-subtle text-success' },
  [CHANNEL_TYPE.WEBCHAT]: { label: 'Webchat', cls: 'bg-shell text-tertiary-foreground' },
};

function ChannelTag({ type }: { type: string }) {
  const tag = CHANNEL_TAG[type] ?? { label: type, cls: 'bg-shell text-tertiary-foreground' };
  return (
    <span className={`inline-flex h-[22px] items-center justify-center whitespace-nowrap rounded-lg px-3 text-xs font-semibold ${tag.cls}`}>
      {tag.label}
    </span>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary text-white' : 'border-[#c6cfdd] bg-shell text-tertiary-foreground hover:bg-black/5'}`}
    >
      {children}
    </button>
  );
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
