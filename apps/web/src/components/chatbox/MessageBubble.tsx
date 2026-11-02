import type { ChatboxMessageOutput } from '@open333crm/shared';
import { LinkifiedText } from '@/components/chatbox/LinkifiedText';

export function MessageBubble({ message }: { message: ChatboxMessageOutput }) {
  const inbound = message.direction === 'INBOUND';
  return (
    <div className={`flex ${inbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-md px-3 py-2 text-sm shadow-sm ${inbound ? 'bg-foreground text-white' : 'bg-muted text-foreground'}`}>
        <MessageContent message={message} />
        <div className={`mt-1 text-[11px] ${inbound ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {message.deliveryStatus === 'expired' ? ' · 此聊天已過期' : ''}
          {message.deliveryStatus === 'failed' ? ' · 傳送失敗' : ''}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ message }: { message: ChatboxMessageOutput }) {
  const payload = message.payload as unknown as Record<string, unknown>;
  if (message.type === 'image' && typeof payload.url === 'string') {
    return <img src={payload.url} alt={typeof payload.altText === 'string' ? payload.altText : 'image'} className="max-h-72 rounded object-contain" />;
  }
  if (message.type === 'video' && typeof payload.url === 'string') {
    return <video src={payload.url} controls className="max-h-72 rounded" />;
  }
  if (message.type === 'file' && typeof payload.url === 'string') {
    return <a className="underline" href={payload.url} target="_blank" rel="noreferrer">{typeof payload.filename === 'string' ? payload.filename : '下載檔案'}</a>;
  }
  if (message.type === 'emoji' && typeof payload.emoji === 'string') {
    return <span className="text-2xl leading-none">{payload.emoji}</span>;
  }
  const text = typeof payload.text === 'string' ? payload.text : '';
  // 訪客自己送出的文字（對 CRM 是 INBOUND）維持純文字，訪客的輸入不當成連結目標（規格 webchat-widget）
  if (message.direction === 'INBOUND') return <p className="whitespace-pre-wrap break-words">{text}</p>;
  return <LinkifiedText text={text} />;
}
