'use client';

import React from 'react';
import { Instagram, Mail, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** LINE 官方品牌 logo（simple-icons, 24×24） */
const LINE_PATH =
  'M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314';

/** Facebook Messenger 官方品牌 logo（simple-icons, 24×24） */
const MESSENGER_PATH =
  'M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.371-.16-3.462-.46a.956.956 0 0 0-.641.05l-2.381 1.05a.96.96 0 0 1-1.35-.85l-.061-2.141a.958.958 0 0 0-.322-.68C1.021 17.66.001 14.809.001 11.639zm8.311-2.16l-3.525 5.591c-.331.53.111 1.16.653.85l3.79-2.87a.717.717 0 0 1 .862 0l2.809 2.09c.85.63 2.049.4 2.6-.5l3.525-5.581c.331-.53-.111-1.16-.653-.85l-3.79 2.87a.717.717 0 0 1-.862 0l-2.809-2.1c-.85-.63-2.049-.4-2.6.5z';

const CHANNEL_NAMES: Record<string, string> = {
  LINE: 'LINE',
  FB: 'Facebook',
  THREADS: 'Instagram',
  WEBCHAT: 'WebChat',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
};

/**
 * 渠道官方 logo（圓形小圖示），用在頭像右下角等空間很小的地方。
 * 只表達「哪一種渠道」；同類型多個帳號要靠渠道名稱區分。
 */
export function ChannelLogo({ channelType, className }: { channelType: string; className?: string }) {
  const label = CHANNEL_NAMES[channelType] ?? channelType;
  const base = cn('inline-flex items-center justify-center rounded-full text-white', className);

  switch (channelType) {
    case 'LINE':
      return (
        <span className={base} style={{ backgroundColor: '#06C755' }} role="img" aria-label={label}>
          <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="currentColor" aria-hidden>
            <path d={LINE_PATH} />
          </svg>
        </span>
      );
    case 'FB':
      return (
        <span
          className={base}
          style={{ background: 'radial-gradient(circle at 30% 100%, #0099FF 0%, #A033FF 60%, #FF5280 90%, #FF7061 100%)' }}
          role="img"
          aria-label={label}
        >
          <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="currentColor" aria-hidden>
            <path d={MESSENGER_PATH} />
          </svg>
        </span>
      );
    case 'THREADS':
      return (
        <span
          className={base}
          style={{ background: 'radial-gradient(circle at 30% 107%, #FDF497 0%, #FD5949 45%, #D6249F 60%, #285AEB 90%)' }}
          role="img"
          aria-label={label}
        >
          <Instagram className="h-[62%] w-[62%]" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case 'WHATSAPP':
      return (
        <span className={base} style={{ backgroundColor: '#25D366' }} role="img" aria-label={label}>
          <MessageCircle className="h-[62%] w-[62%]" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case 'EMAIL':
      return (
        <span className={cn(base, 'bg-ai')} role="img" aria-label={label}>
          <Mail className="h-[62%] w-[62%]" strokeWidth={2.5} aria-hidden />
        </span>
      );
    default:
      return (
        <span className={base} style={{ backgroundColor: '#475569' }} role="img" aria-label={label}>
          <MessageCircle className="h-[62%] w-[62%]" strokeWidth={2.5} aria-hidden />
        </span>
      );
  }
}

/** 渠道類型的顯示名稱（LINE／Facebook／Instagram…），給 title／aria 用 */
export function channelTypeName(channelType: string): string {
  return CHANNEL_NAMES[channelType] ?? channelType;
}
