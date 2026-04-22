'use client';

import React, { useState } from 'react';
import { Loader2, CheckCircle, XCircle, Copy, Check } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CHANNEL_TYPE } from '@open333crm/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface ChannelWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webhookBaseUrl?: string;
  onComplete: () => void;
}

type WizardStep = 'type' | 'credentials' | 'verify' | 'done';

interface VerifyState {
  status: 'idle' | 'verifying' | 'success' | 'error';
  message?: string;
  webhookSetup?: boolean;
  embedCode?: string;
}

export function ChannelWizard({ open, onOpenChange, webhookBaseUrl, onComplete }: ChannelWizardProps) {
  const [step, setStep] = useState<WizardStep>('type');
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

  const [creating, setCreating] = useState(false);
  const [createdChannelId, setCreatedChannelId] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setStep('type');
    setChannelType('LINE');
    setDisplayName('');
    setChannelSecret('');
    setChannelAccessToken('');
    setAppId('');
    setAppSecret('');
    setPageAccessToken('');
    setPageId('');
    setCreating(false);
    setCreatedChannelId(null);
    setVerify({ status: 'idle' });
    setError(null);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleCreateAndVerify = async () => {
    setCreating(true);
    setError(null);
    setVerify({ status: 'idle' });

    try {
      // Build credentials
      let credentials: Record<string, unknown>;
      if (channelType === CHANNEL_TYPE.FB) {
        if (!appSecret || !pageAccessToken) {
          setError('請填寫 App Secret 和 Page Access Token');
          setCreating(false);
          return;
        }
        credentials = {
          appId,
          appSecret,
          pageAccessToken,
          pageId,
          verifyToken: `open333crm_${Date.now().toString(36)}`,
        };
      } else if (channelType === CHANNEL_TYPE.WEBCHAT) {
        credentials = {
          channelSecret: channelSecret || `webchat_${Date.now().toString(36)}`,
          channelAccessToken: channelAccessToken || `webchat_token_${Date.now().toString(36)}`,
        };
      } else {
        if (!channelSecret || !channelAccessToken) {
          setError('請填寫 Channel Secret 和 Channel Access Token');
          setCreating(false);
          return;
        }
        credentials = { channelSecret, channelAccessToken };
      }

      // Create channel
      const payload: Record<string, unknown> = {
        channelType,
        displayName: displayName || `My ${channelType} Channel`,
        credentials,
      };
      if (webhookBaseUrl) payload.webhookBaseUrl = webhookBaseUrl;

      const createRes = await api.post('/channels', payload);
      const newChannel = createRes.data?.data;
      const newId = newChannel?.id;
      setCreatedChannelId(newId);

      // Move to verify step
      setStep('verify');
      setVerify({ status: 'verifying' });

      // Verify channel
      try {
        await api.post(`/channels/${newId}/verify`);
        setVerify({ status: 'success', message: '渠道驗證成功' });
      } catch (verifyErr: any) {
        setVerify({
          status: 'error',
          message: verifyErr.response?.data?.error?.message || '驗證失敗，但渠道已建立',
        });
      }

      // For LINE: auto-setup webhook
      if (channelType === CHANNEL_TYPE.LINE) {
        try {
          const setupRes = await api.post(`/channels/${newId}/setup-webhook`);
          const setupData = setupRes.data?.data;
          setVerify((prev) => ({
            ...prev,
            webhookSetup: setupData?.webhookSet === true,
            message: prev.message
              ? `${prev.message}。Webhook 已自動設定。`
              : 'Webhook 已自動設定',
          }));
        } catch {
          setVerify((prev) => ({
            ...prev,
            webhookSetup: false,
          }));
        }
      }

      // For WEBCHAT: get embed code
      if (channelType === CHANNEL_TYPE.WEBCHAT) {
        try {
          const embedRes = await api.get(`/channels/${newId}/embed-code`);
          setVerify((prev) => ({
            ...prev,
            embedCode: embedRes.data?.data?.html,
            status: 'success',
            message: '渠道建立成功',
          }));
        } catch {
          // non-critical
        }
      }

      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '建立渠道失敗，請檢查輸入資料');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyEmbed = () => {
    if (verify.embedCode) {
      navigator.clipboard.writeText(verify.embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const channelTypeOptions = [
    { value: 'LINE', label: 'LINE' },
    { value: 'FB', label: 'Facebook Messenger' },
    { value: 'WEBCHAT', label: 'WebChat (網頁聊天)' },
  ];

  const stepLabels: Record<WizardStep, string> = {
    type: '步驟 1/4：選擇渠道類型',
    credentials: '步驟 2/4：輸入憑證',
    verify: '步驟 3/4：驗證中...',
    done: '步驟 4/4：完成',
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{stepLabels[step]}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 min-h-[200px]">
          {/* Step indicator */}
          <div className="flex gap-1">
            {(['type', 'credentials', 'verify', 'done'] as WizardStep[]).map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${
                  i <= ['type', 'credentials', 'verify', 'done'].indexOf(step)
                    ? 'bg-primary'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Step 1: Select Type */}
          {step === 'type' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">渠道類型</label>
                <Select
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value)}
                  options={channelTypeOptions}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">顯示名稱</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={
                    channelType === CHANNEL_TYPE.FB
                      ? '例：我的粉絲專頁'
                      : channelType === CHANNEL_TYPE.LINE
                        ? '例：我的 LINE 官方帳號'
                        : '例：官網即時客服'
                  }
                />
              </div>
            </div>
          )}

          {/* Step 2: Credentials */}
          {step === 'credentials' && (
            <div className="space-y-4">
              {channelType === CHANNEL_TYPE.LINE && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Channel Secret</label>
                    <Input
                      type="password"
                      value={channelSecret}
                      onChange={(e) => setChannelSecret(e.target.value)}
                      placeholder="從 LINE Developer Console 取得"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      LINE Developer Console → Messaging API → Channel Secret
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Channel Access Token</label>
                    <Input
                      type="password"
                      value={channelAccessToken}
                      onChange={(e) => setChannelAccessToken(e.target.value)}
                      placeholder="從 LINE Developer Console 取得"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      LINE Developer Console → Messaging API → Channel Access Token (long-lived)
                    </p>
                  </div>
                </>
              )}

              {channelType === CHANNEL_TYPE.FB && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">App ID</label>
                    <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="Facebook App ID" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">App Secret</label>
                    <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="Facebook App Secret" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Page Access Token</label>
                    <Input type="password" value={pageAccessToken} onChange={(e) => setPageAccessToken(e.target.value)} placeholder="EAA... 開頭的 Token" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Page ID</label>
                    <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="粉絲專頁數字 ID（選填）" />
                  </div>
                </>
              )}

              {channelType === CHANNEL_TYPE.WEBCHAT && (
                <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    WebChat 渠道不需要外部憑證，系統會自動產生。建立後即可取得嵌入碼。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Verifying */}
          {step === 'verify' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在驗證渠道連線...</p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {verify.status === 'success' ? (
                  <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-yellow-500 shrink-0" />
                )}
                <p className="text-sm font-medium">
                  {verify.message || '渠道已建立'}
                </p>
              </div>

              {channelType === CHANNEL_TYPE.LINE && verify.webhookSetup !== undefined && (
                <div className={`rounded-md p-3 text-sm ${verify.webhookSetup ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200' : 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200'}`}>
                  {verify.webhookSetup
                    ? 'LINE Webhook 已自動設定完成，無需手動配置。'
                    : 'Webhook 自動設定失敗，請手動到 LINE Developer Console 設定 Webhook URL。'}
                </div>
              )}

              {channelType === CHANNEL_TYPE.WEBCHAT && verify.embedCode && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">嵌入碼</p>
                  <div className="relative">
                    <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                      {verify.embedCode}
                    </pre>
                    <Button
                      size="sm"
                      variant="outline"
                      className="absolute top-2 right-2"
                      onClick={handleCopyEmbed}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    將此程式碼貼入您網站的 {'<body>'} 標籤中即可啟用聊天功能。
                  </p>
                </div>
              )}
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
          {step === 'type' && (
            <>
              <Button variant="outline" onClick={handleClose}>取消</Button>
              <Button onClick={() => setStep('credentials')}>下一步</Button>
            </>
          )}
          {step === 'credentials' && (
            <>
              <Button variant="outline" onClick={() => setStep('type')}>上一步</Button>
              <Button onClick={handleCreateAndVerify} disabled={creating}>
                {creating ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />建立中...</>
                ) : (
                  '建立並驗證'
                )}
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={() => { onComplete(); handleClose(); }}>
              完成
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
