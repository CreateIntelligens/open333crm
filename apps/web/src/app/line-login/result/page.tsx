'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const messages: Record<string, { title: string; description: string; emoji: string }> = {
  success: {
    title: '授權成功',
    description: '感謝您提供 Email！我們將為您提供更完善的服務。您可以關閉此頁面。',
    emoji: '✅',
  },
  cancelled: {
    title: '授權已取消',
    description: '您已取消 Email 授權。如需提供 Email，請再次點擊客服傳送的連結。',
    emoji: '⚠️',
  },
  no_email: {
    title: '無法取得 Email',
    description: '您的 LINE 帳號似乎沒有綁定 Email，或未同意分享 Email 資訊。請確認後再試一次。',
    emoji: '📭',
  },
  error: {
    title: '發生錯誤',
    description: '處理過程中發生錯誤，請稍後再試或聯繫客服人員。',
    emoji: '❌',
  },
};

function ResultContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status') || 'error';
  const info = messages[status] || messages.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="mb-4 text-5xl">{info.emoji}</div>
        <h1 className="mb-3 text-xl font-bold text-gray-900">{info.title}</h1>
        <p className="text-sm leading-relaxed text-gray-600">{info.description}</p>
      </div>
    </div>
  );
}

export default function LineLoginResultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-gray-500">載入中...</p>
        </div>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
