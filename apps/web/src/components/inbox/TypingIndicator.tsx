'use client';

import React, { useEffect, useState } from 'react';
import { useSocket } from '@/providers/SocketProvider';

interface TypingIndicatorProps {
  conversationId: string;
}

export function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const { socket } = useSocket();
  const [typingAgent, setTypingAgent] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !conversationId) return;

    const handleStart = (payload: { conversationId: string; agentName?: string }) => {
      if (payload.conversationId === conversationId) {
        setTypingAgent(payload.agentName || '客服');
      }
    };

    const handleStop = (payload: { conversationId: string }) => {
      if (payload.conversationId === conversationId) {
        setTypingAgent(null);
      }
    };

    socket.on('typing.start', handleStart);
    socket.on('typing.stop', handleStop);

    return () => {
      socket.off('typing.start', handleStart);
      socket.off('typing.stop', handleStop);
    };
  }, [socket, conversationId]);

  if (!typingAgent) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-muted-foreground">{typingAgent} 正在輸入...</span>
    </div>
  );
}
