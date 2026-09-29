'use client';

import React, { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { usePermission } from '@/providers/AuthProvider';

const RESULT_TEXT: Record<string, string> = {
  no_targets: '沒有其他可綁定的渠道，請先到「渠道管理」設定各渠道的導流識別。',
  rate_limited: '此顧客一小時內的綁定連結申請次數過多，請稍後再試。',
};

/**
 * 客服代顧客送出跨渠道綁定連結（會在目前的對話中送出一次性代碼與其他渠道的連結）。
 * 對應 API：POST /contacts/:id/binding-link
 */
export function SendBindingLinkButton({ contactId, conversationId }: { contactId: string; conversationId: string }) {
  const canUpdate = usePermission('contact.update');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);

  if (!canUpdate) return null;

  const handleClick = async () => {
    setSending(true);
    setNotice(null);
    try {
      const res = await api.post(`/contacts/${contactId}/binding-link`, { conversationId });
      const { status, targets } = res.data.data as { status: string; targets: number };
      if (status === 'sent') {
        setNotice({ tone: 'success', text: `已在對話中送出綁定連結（可綁定 ${targets} 個帳號）` });
      } else {
        setNotice({ tone: 'warning', text: RESULT_TEXT[status] ?? '綁定連結沒有送出' });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: getApiErrorMessage(err, '傳送綁定連結失敗，請稍後重試') });
    } finally {
      setSending(false);
    }
  };

  const toneClass = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-destructive',
  } as const;

  return (
    <div className="space-y-1">
      <Button variant="outline" className="w-full" disabled={sending} onClick={handleClick}>
        <Link2 className="mr-2 h-4 w-4" />
        {sending ? '傳送中...' : '傳送跨渠道綁定連結'}
      </Button>
      {notice && <p className={`text-xs ${toneClass[notice.tone]}`}>{notice.text}</p>}
    </div>
  );
}
