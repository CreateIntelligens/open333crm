'use client';

import React, { useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'AGENT_HANDLED' && status !== 'ACTIVE') return null;

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/conversations/${conversationId}/return-to-bot`, {});
      onDone();
    } catch (err) {
      setError(getApiErrorMessage(err, '交回 Bot 失敗，請稍後重試'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 text-ai hover:bg-ai-subtle hover:text-ai"
        onClick={handleClick}
        disabled={busy}
        title="讓機器人繼續回覆這段對話"
      >
        <Bot className="h-4 w-4" />
        <span className="text-xs">交回 Bot</span>
      </Button>
    </div>
  );
}
