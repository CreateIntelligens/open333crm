'use client';

import React, { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';

interface ReturnToBotButtonProps {
  conversationId: string;
  status: string;
  /** 交回成功後重新載入對話 */
  onDone: () => void;
}

/**
 * 把客服處理中或進行中的對話交回 Bot（change add-return-conversation-to-bot）。
 * Bot 處理中或已結案的對話不顯示；失敗原因（例如渠道的機器人已關閉）顯示在按鈕旁。
 */
export function ReturnToBotButton({ conversationId, status, onDone }: ReturnToBotButtonProps) {
  // ChatWindow 切換對話時不重建這個元件，處理中與錯誤都記下屬於哪筆對話：
  // 請求還沒回來就換對話時，舊對話的結果不會顯示在新對話上
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [error, setError] = useState<{ conversationId: string; message: string } | null>(null);

  // 換對話就清掉錯誤，切回原對話也不顯示舊的
  useEffect(() => {
    setError(null);
  }, [conversationId]);

  if (status !== 'AGENT_HANDLED' && status !== 'ACTIVE') return null;

  const handleClick = async () => {
    const target = conversationId;
    setBusyFor(target);
    setError(null);
    try {
      await api.post(`/conversations/${target}/return-to-bot`, {});
      onDone();
    } catch (err) {
      setError({ conversationId: target, message: getApiErrorMessage(err, '交回 Bot 失敗，請稍後重試') });
    } finally {
      setBusyFor((current) => (current === target ? null : current));
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error?.conversationId === conversationId && <span className="text-xs text-destructive">{error.message}</span>}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 text-ai hover:bg-ai-subtle hover:text-ai"
        onClick={handleClick}
        disabled={busyFor === conversationId}
        title="讓機器人繼續回覆這段對話"
      >
        <Bot className="h-4 w-4" />
        <span className="text-xs">交回 Bot</span>
      </Button>
    </div>
  );
}
