'use client';

import React from 'react';
import { Bot, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StatusBannerProps {
  status: string;
  onReopen?: () => void;
  onTakeover?: () => void;
}

export function StatusBanner({ status, onReopen, onTakeover }: StatusBannerProps) {
  if (status === 'BOT_HANDLED') {
    return (
      <div className="flex items-center justify-between bg-purple-50 px-4 py-2 border-b border-purple-100">
        <div className="flex items-center gap-2 text-sm text-purple-700">
          <Bot className="h-4 w-4" />
          <span className="font-medium">Bot 自動處理中</span>
        </div>
        {onTakeover && (
          <Button size="sm" variant="outline" className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100" onClick={onTakeover}>
            接管對話
          </Button>
        )}
      </div>
    );
  }

  if (status === 'CLOSED') {
    return (
      <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Lock className="h-4 w-4" />
          <span className="font-medium">此對話已關閉</span>
        </div>
        {onReopen && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReopen}>
            <RotateCcw className="mr-1 h-3 w-3" />
            重新開啟對話
          </Button>
        )}
      </div>
    );
  }

  return null;
}
