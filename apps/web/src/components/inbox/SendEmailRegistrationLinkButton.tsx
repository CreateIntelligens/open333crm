'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { usePermission } from '@/providers/AuthProvider';
import { fetchIdentityBindingStatus } from './identity-binding-status';

const RESULT_TEXT: Record<string, string> = {
  rate_limited: '此顧客一小時內的登記連結申請次數過多，請稍後再試。',
  delivery_failed: '登記連結沒有送到顧客（渠道發送失敗），請確認渠道狀態後再試。',
};

/**
 * 客服代顧客送出 email 登記連結（change add-email-identity-merge）。
 * 顧客填入的 email 與其他聯絡人相同時，系統會自動歸戶。對應 API：POST /contacts/:id/email-registration-link
 */
export function SendEmailRegistrationLinkButton({ contactId, conversationId }: { contactId: string; conversationId: string }) {
  // 在對話中發訊息給顧客，需要回覆權限
  const canReply = usePermission('inbox.reply');
  const [enabled, setEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!canReply) return;
    let cancelled = false;
    fetchIdentityBindingStatus()
      .then((status) => {
        if (!cancelled) setEnabled(status.emailEnabled);
      })
      .catch(() => {
        // 查不到就不顯示按鈕（功能預設關閉），不影響收件匣其他操作
      });
    return () => {
      cancelled = true;
    };
  }, [canReply]);

  // 結果只顯示在送出時的對話：請求還沒回來就切到別的對話時，不顯示
  const currentConversation = useRef(conversationId);
  useEffect(() => {
    currentConversation.current = conversationId;
    setNotice(null);
  }, [conversationId]);

  if (!canReply || !enabled) return null;

  const handleClick = async () => {
    const sentFor = conversationId;
    const show = (n: { tone: 'success' | 'warning' | 'error'; text: string }) => {
      if (currentConversation.current === sentFor) setNotice(n);
    };
    setSending(true);
    setNotice(null);
    try {
      const res = await api.post(`/contacts/${contactId}/email-registration-link`, { conversationId });
      const { status } = res.data.data as { status: string };
      if (status === 'sent') {
        show({ tone: 'success', text: '已在對話中送出 email 登記連結' });
      } else {
        show({ tone: status === 'delivery_failed' ? 'error' : 'warning', text: RESULT_TEXT[status] ?? '登記連結沒有送出' });
      }
    } catch (err) {
      show({ tone: 'error', text: getApiErrorMessage(err, '傳送登記連結失敗，請稍後重試') });
    } finally {
      setSending(false);
    }
  };

  const toneClass = { success: 'text-success', warning: 'text-warning', error: 'text-destructive' } as const;

  return (
    <div className="space-y-1">
      <Button variant="outline" className="w-full" disabled={sending} onClick={handleClick}>
        <Mail className="mr-2 h-4 w-4" />
        {sending ? '傳送中...' : '傳送 email 登記連結'}
      </Button>
      {notice && <p className={`text-xs ${toneClass[notice.tone]}`}>{notice.text}</p>}
    </div>
  );
}
