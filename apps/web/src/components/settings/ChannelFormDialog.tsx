'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect } from 'react';
import { Loader2, Copy, Check } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface ChannelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: {
    id: string;
    channelType: string;
    displayName: string;
    webhookUrl?: string;
  } | null;
  webhookBaseUrl?: string;
  onSaved: () => void;
}

export function ChannelFormDialog({
  open,
  onOpenChange,
  channel,
  webhookBaseUrl,
  onSaved,
}: ChannelFormDialogProps) {
  const isEditing = !!channel;

  const [channelType, setChannelType] = useState('LINE');
  const [displayName, setDisplayName] = useState('');

  // LINE credentials
  const [channelSecret, setChannelSecret] = useState('');
  const [channelAccessToken, setChannelAccessToken] = useState('');

  // FB credentials
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [pageId, setPageId] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (channel) {
      setChannelType(channel.channelType);
      setDisplayName(channel.displayName);
    } else {
      setChannelType('LINE');
      setDisplayName('');
    }
    // Reset all credential fields
    setChannelSecret('');
    setChannelAccessToken('');
    setAppId('');
    setAppSecret('');
    setPageAccessToken('');
    setPageId('');
    setError(null);
    setCopied(false);
  }, [channel, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (isEditing) {
        const editPayload: Record<string, unknown> = {
          displayName,
        };
        // Build credentials based on channel type
        if (channel!.channelType === 'FB') {
          if (appSecret && pageAccessToken) {
            editPayload.credentials = {
              appId: appId || undefined,
              appSecret,
              pageAccessToken,
              pageId: pageId || undefined,
              verifyToken: `open333crm_${channel!.id.slice(0, 8)}`,
            };
          }
        } else {
          if (channelSecret && channelAccessToken) {
            editPayload.credentials = {
              channelSecret,
              channelAccessToken,
            };
          }
        }
        await api.patch(`/channels/${channel!.id}`, editPayload);
      } else {
        // Create new channel
        let credentials: Record<string, unknown>;

        if (channelType === 'FB') {
          if (!appSecret || !pageAccessToken) {
            setError('請填寫 App Secret 和 Page Access Token');
            setSaving(false);
            return;
          }
          // Generate a verify token for FB webhook verification
          const verifyToken = `open333crm_${Date.now().toString(36)}`;
          credentials = {
            appId,
            appSecret,
            pageAccessToken,
            pageId,
            verifyToken,
          };
        } else {
          if (!channelSecret || !channelAccessToken) {
            setError('請填寫 Channel Secret 和 Channel Access Token');
            setSaving(false);
            return;
          }
          credentials = {
            channelSecret,
            channelAccessToken,
          };
        }

        const payload: Record<string, unknown> = {
          channelType,
          displayName,
          credentials,
        };
        if (webhookBaseUrl) {
          payload.webhookBaseUrl = webhookBaseUrl;
        }
        await api.post('/channels', payload);
      }

      onSaved();
    } catch (err: any) {
      setError(
        err.response?.data?.error?.message || '儲存失敗，請檢查輸入資料'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCopyWebhook = () => {
    if (channel?.webhookUrl) {
      navigator.clipboard.writeText(channel.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const channelTypeOptions = [
    { value: 'LINE', label: 'LINE' },
    { value: 'FB', label: 'Facebook' },
    { value: 'WEBCHAT', label: 'WebChat' },
  ];

  const effectiveType = isEditing ? channel!.channelType : channelType;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? '編輯渠道' : '新增渠道'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {/* Channel Type */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                渠道類型
              </label>
              <Select
                value={effectiveType}
                onChange={(e) => setChannelType(e.target.value)}
                options={channelTypeOptions}
                disabled={isEditing}
              />
            </div>

            {/* Display Name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                顯示名稱
              </label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={
                  effectiveType === 'FB'
                    ? '例：XX 品牌粉絲專頁'
                    : effectiveType === 'LINE'
                      ? '例：我的 LINE 官方帳號'
                      : '例：官網即時客服'
                }
                required
              />
            </div>

            {/* LINE Credentials */}
            {effectiveType === 'LINE' && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Channel Secret
                  </label>
                  <Input
                    type="password"
                    value={channelSecret}
                    onChange={(e) => setChannelSecret(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : '從 LINE Developer Console 取得'}
                    required={!isEditing}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Channel Access Token
                  </label>
                  <Input
                    type="password"
                    value={channelAccessToken}
                    onChange={(e) => setChannelAccessToken(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : '從 LINE Developer Console 取得'}
                    required={!isEditing}
                  />
                </div>
              </>
            )}

            {/* FB Credentials */}
            {effectiveType === 'FB' && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    App ID
                  </label>
                  <Input
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : '從 Facebook Developer Console 取得'}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Settings → Basic → App ID
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    App Secret
                  </label>
                  <Input
                    type="password"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : '從 Facebook Developer Console 取得'}
                    required={!isEditing}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Settings → Basic → App Secret（用於 Webhook 簽名驗證）
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Page Access Token
                  </label>
                  <Input
                    type="password"
                    value={pageAccessToken}
                    onChange={(e) => setPageAccessToken(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : 'EAA... 開頭的長字串'}
                    required={!isEditing}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Messenger → Settings → Token Generation → 選擇粉專 → Generate Token
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Page ID
                  </label>
                  <Input
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    placeholder="粉絲專頁數字 ID"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    粉專設定 → 關於，或 Token Generation 頁面旁邊
                  </p>
                </div>
              </>
            )}

            {/* WEBCHAT - minimal credentials */}
            {effectiveType === 'WEBCHAT' && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Channel Secret
                  </label>
                  <Input
                    type="password"
                    value={channelSecret}
                    onChange={(e) => setChannelSecret(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : '任意字串作為驗證金鑰'}
                    required={!isEditing}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Channel Access Token
                  </label>
                  <Input
                    type="password"
                    value={channelAccessToken}
                    onChange={(e) => setChannelAccessToken(e.target.value)}
                    placeholder={isEditing ? '留空表示不更新' : '任意字串作為 API Token'}
                    required={!isEditing}
                  />
                </div>
              </>
            )}

            {/* Webhook URL (shown for editing) */}
            {isEditing && channel?.webhookUrl && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Webhook URL
                </label>
                <div className="flex gap-2">
                  <Input
                    value={channel.webhookUrl}
                    readOnly
                    className="bg-muted text-xs font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyWebhook}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {effectiveType === 'FB'
                    ? '請在 Facebook App → Messenger → Webhooks 中設定此 URL，並填入系統產生的 Verify Token'
                    : effectiveType === 'LINE'
                      ? '請在 LINE Developer Console 的 Messaging API 設定中，將此 URL 設為 Webhook URL'
                      : '此為系統內部使用的 Webhook URL'}
                </p>
              </div>
            )}

            {/* FB-specific: show verify token info after creation */}
            {isEditing && effectiveType === 'FB' && (
              <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3">
                <p className="text-xs text-blue-800 dark:text-blue-200 font-medium mb-1">
                  Facebook Webhook 設定提示
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  1. 到 Facebook App → Messenger → Settings → Webhooks{'\n'}
                  2. 點 &quot;Edit Callback URL&quot;{'\n'}
                  3. 貼入上方 Webhook URL{'\n'}
                  4. Verify Token 填入：<code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">open333crm_{channel!.id.slice(0, 8)}</code>{'\n'}
                  5. 訂閱：messages, messaging_postbacks
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  儲存中...
                </>
              ) : (
                '儲存'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
