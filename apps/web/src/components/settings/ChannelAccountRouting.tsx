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
        title: '訊息中含其他渠道的事件，未轉發到下游 Webhook',
        hint: '共用同一個 Meta 應用程式的多個粉專同時有訊息時會發生；此渠道自己的訊息仍正常處理。',
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
}: {
  channelType: string;
  externalAccountId?: string | null;
  settings?: Record<string, unknown>;
}) {
  const label = ACCOUNT_LABEL[channelType];
  if (!label) return null;

  const warning = settings?.webhookRouting as WebhookRoutingWarning | undefined;
  const text = warning?.reason ? warningText(warning) : null;

  return (
    <div className="mt-0.5 space-y-1">
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
