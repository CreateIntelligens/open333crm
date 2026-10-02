'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface WebhookRoutingWarning {
  reason?: 'account_id_missing' | 'unrouted_account' | 'app_mismatch' | 'downstream_skipped' | string;
  accountId?: string | null;
  lastAt?: string;
}

const ACCOUNT_LABEL: Record<string, string> = {
  FB: '粉專 ID',
  THREADS: 'IG 帳號 ID',
};

function warningText(w: WebhookRoutingWarning): { title: string; hint: string } {
  switch (w.reason) {
    case 'account_id_missing':
      return {
        title: '尚未取得帳號 ID，暫以相容模式收訊',
        hint: '按「測試連線」讓系統取得帳號 ID。取得前，共用同一個 Meta 應用程式的其他粉專訊息可能被誤收進此渠道。',
      };
    case 'unrouted_account':
      return {
        title: `收到不屬於此渠道的帳號（${w.accountId ?? '未知'}）的訊息，已略過`,
        hint: '此渠道的 Meta 應用程式也連結了這個帳號，但系統中沒有對應的渠道。若要接收，請為該帳號建立渠道並按「測試連線」。',
      };
    case 'app_mismatch':
      return {
        title: `帳號 ${w.accountId ?? ''} 的訊息來自不同的 Meta 應用程式，已略過`,
        hint: '請確認各渠道填入的應用程式密鑰是否正確。',
      };
    case 'downstream_skipped':
      return {
        title: '部分訊息未轉發到下游 Webhook，已改由系統直接處理',
        hint: '共用同一個 Meta 應用程式的多個粉專同時有訊息時，Meta 會把它們打包成一批送來，系統無法只轉發屬於此渠道的部分。這些訊息仍會進收件匣，但下游系統沒有收到。',
      };
    default:
      return { title: 'Webhook 分派異常', hint: '' };
  }
}

/**
 * FB／IG 渠道的外部帳號 ID 與 webhook 分派警示（change fix-meta-webhook-page-routing）。
 * 帳號 ID 由「測試連線」（驗證）自動取得；分派警示由 webhook 寫入 settings.webhookRouting。
 */
export function ChannelAccountRouting({
  channelType,
  externalAccountId,
  settings,
  isActive = true,
}: {
  channelType: string;
  externalAccountId?: string | null;
  settings?: Record<string, unknown>;
  /** 已停用的渠道不持有帳號 ID、也不收訊，不顯示「請按測試連線」等提示，以免誤導 */
  isActive?: boolean;
}) {
  const label = ACCOUNT_LABEL[channelType];
  if (!label) return null;
  if (!isActive) return null;

  const warning = settings?.webhookRouting as WebhookRoutingWarning | undefined;
  const text = warning?.reason ? warningText(warning) : null;

  const connectedViaPlatform = (settings?.metaConnect as { mode?: string } | undefined)?.mode === 'platform';
  const tokenHealth = settings?.tokenHealth as { status?: string; checkedAt?: string } | undefined;
  const tokenInvalid = tokenHealth?.status === 'invalid';

  return (
    <div className="mt-0.5 space-y-1">
      {tokenInvalid && (
        <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">存取權杖已失效，目前收不到也無法回覆訊息</p>
            <p className="mt-0.5">
              {connectedViaPlatform
                ? '請按上方「用 Facebook 連結粉專」重新連結這個粉專，原本的對話紀錄會保留。'
                : '請按編輯，貼上新的存取權杖後按「測試連線」。'}
            </p>
            {tokenHealth?.checkedAt && (
              <p className="mt-0.5 opacity-80">檢查時間：{new Date(tokenHealth.checkedAt).toLocaleString('zh-TW')}</p>
            )}
          </div>
        </div>
      )}
      {connectedViaPlatform && <p className="text-xs text-muted-foreground">透過 Facebook 登入連結，不需另外設定 Webhook</p>}
      {externalAccountId && (
        <p className="text-xs text-muted-foreground">
          {label}：<span className="font-mono">{externalAccountId}</span>
        </p>
      )}
      {text && (
        <div className="flex items-start gap-1.5 rounded-md bg-warning-subtle px-2 py-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{text.title}</p>
            {text.hint && <p className="mt-0.5">{text.hint}</p>}
            {warning?.lastAt && (
              <p className="mt-0.5 opacity-80">最後發生：{new Date(warning.lastAt).toLocaleString('zh-TW')}</p>
            )}
          </div>
        </div>
      )}
      {!externalAccountId && !text && (
        <p className="text-xs text-warning">尚未取得{label}，請按「測試連線」</p>
      )}
    </div>
  );
}
