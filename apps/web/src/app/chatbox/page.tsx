'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Send, XCircle } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import type {
  ChatboxBootstrapConfig,
  ChatboxFingerprintInput,
  ChatboxMessageOutput,
  ChatboxMessageType,
} from '@open333crm/shared';
import { API_BASE_URL, REALTIME_ORIGIN } from '@/lib/constants';

type LoadState = 'loading' | 'ready' | 'error';

function getFingerprint(): ChatboxFingerprintInput {
  const width = window.screen?.width ?? 0;
  const height = window.screen?.height ?? 0;
  const maxSide = Math.max(width, height);
  const screenBucket = maxSide >= 1600 ? 'xl' : maxSide >= 1024 ? 'lg' : maxSide >= 768 ? 'md' : 'sm';

  return {
    browserFamily: detectBrowser(),
    osFamily: detectOs(),
    language: navigator.language || 'unknown',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    screenBucket,
  };
}

function detectBrowser(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('firefox/') || ua.includes('fxios/')) return 'firefox';
  if (ua.includes('safari/')) return 'safari';
  return 'unknown';
}

function detectOs(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function newClientMessageId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSocketMessage(raw: any): ChatboxMessageOutput {
  return {
    id: raw.id ?? newClientMessageId(),
    direction: raw.direction ?? 'OUTBOUND',
    senderType: raw.senderType ?? 'AGENT',
    senderId: raw.senderId ?? null,
    type: (raw.type ?? raw.contentType ?? 'text') as ChatboxMessageType,
    payload: raw.payload ?? raw.content ?? {},
    createdAt: raw.createdAt ?? new Date().toISOString(),
    sequence: raw.sequence ?? null,
    deliveryStatus: raw.deliveryStatus ?? 'sent',
  };
}

function sortMessages(messages: ChatboxMessageOutput[]): ChatboxMessageOutput[] {
  return [...messages].sort((a, b) => {
    if (a.sequence != null && b.sequence != null && a.sequence !== b.sequence) {
      return a.sequence - b.sequence;
    }
    const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return timeDelta || a.id.localeCompare(b.id);
  });
}

export default function ChatboxPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ChatboxBootstrapConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatboxMessageOutput[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fingerprintRef = useRef<ChatboxFingerprintInput | null>(null);
  const claimTokenRef = useRef<string | null>(null);
  const sortedMessages = useMemo(() => sortMessages(messages), [messages]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const currentSessionId = params.get('sessionId');
      const channel = params.get('channel') ?? '';
      const fingerprint = getFingerprint();
      fingerprintRef.current = fingerprint;

      async function createAndRedirect() {
        if (!channel) {
          throw new Error('CHANNEL_REQUIRED');
        }
        const response = await fetch(`${API_BASE_URL}/chatbox/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, fingerprint }),
        });
        if (!response.ok) throw new Error('SESSION_CREATE_FAILED');
        const { data } = await response.json();
        window.location.replace(data.redirectUrl);
      }

      if (!currentSessionId) {
        await createAndRedirect();
        return;
      }

      const response = await fetch(`${API_BASE_URL}/chatbox/sessions/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, fingerprint }),
      });

      if (response.status === 401 && !cancelled) {
        setLoadState('error');
        setError('此聊天已過期。');
        return;
      }

      if (response.status === 403 && !cancelled) {
        setLoadState('error');
        setError('此聊天連結已被使用，請重新開啟新的聊天室。');
        return;
      }

      if (!response.ok) {
        throw new Error('SESSION_VERIFY_FAILED');
      }

      const { data } = await response.json();
      if (cancelled) return;

      setSessionId(currentSessionId);
      claimTokenRef.current = data.claimToken;
      setConfig(data.config);
      setMessages(data.config.greeting ? [{
        id: 'greeting',
        direction: 'OUTBOUND',
        senderType: 'BOT',
        type: 'text',
        payload: { text: data.config.greeting },
        createdAt: new Date().toISOString(),
        sequence: null,
        deliveryStatus: 'sent',
      }] : []);
      setLoadState('ready');

      const socket = io(`${REALTIME_ORIGIN}/visitor`, {
        auth: { sessionId: currentSessionId, claimToken: data.claimToken, fingerprint },
        transports: ['websocket', 'polling'],
      });
      socketRef.current = socket;
      socket.on('agent:message', (message) => {
        setMessages((current) => [...current, normalizeSocketMessage(message)]);
      });
      socket.on('connect_error', () => {
        setError('連線中斷，請稍後再試。');
      });
    }

    boot().catch(() => {
      if (!cancelled) {
        setLoadState('error');
        setError('無法開啟聊天室。');
      }
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, []);

  async function sendText() {
    const text = input.trim();
    if (!text || !sessionId || !claimTokenRef.current || sending) return;

    const optimistic: ChatboxMessageOutput = {
      id: newClientMessageId(),
      direction: 'INBOUND',
      senderType: 'CONTACT',
      type: 'text',
      payload: { text },
      createdAt: new Date().toISOString(),
      sequence: null,
      deliveryStatus: 'pending',
    };
    setMessages((current) => [...current, optimistic]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chatbox/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          claimToken: claimTokenRef.current,
          clientMessageId: optimistic.id,
          type: 'text',
          payload: { text },
          fingerprint: fingerprintRef.current,
          sentAt: optimistic.createdAt,
        }),
      });
      if (response.status === 401) throw new Error('SESSION_EXPIRED');
      if (!response.ok) throw new Error('SEND_FAILED');
      const { data } = await response.json();
      setMessages((current) => current.map((message) => (
        message.id === optimistic.id ? data.message : message
      )));
    } catch (err) {
      const deliveryStatus = err instanceof Error && err.message === 'SESSION_EXPIRED' ? 'expired' : 'failed';
      setMessages((current) => current.map((message) => (
        message.id === optimistic.id ? { ...message, deliveryStatus } : message
      )));
    } finally {
      setSending(false);
    }
  }

  async function sendMedia(file: File) {
    if (!sessionId || !claimTokenRef.current) return;
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('claimToken', claimTokenRef.current);
    formData.append('fingerprint', JSON.stringify(fingerprintRef.current));
    formData.append('file', file);

    setSending(true);
    try {
      const upload = await fetch(`${API_BASE_URL}/chatbox/media`, { method: 'POST', body: formData });
      if (!upload.ok) throw new Error('UPLOAD_FAILED');
      const { data } = await upload.json();
      const clientMessageId = newClientMessageId();
      const response = await fetch(`${API_BASE_URL}/chatbox/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          claimToken: claimTokenRef.current,
          clientMessageId,
          type: data.contentType,
          payload: { url: data.url, filename: file.name, mimeType: file.type, sizeBytes: file.size },
          fingerprint: fingerprintRef.current,
          sentAt: new Date().toISOString(),
        }),
      });
      if (response.status === 401) throw new Error('SESSION_EXPIRED');
      if (!response.ok) throw new Error('MEDIA_SEND_FAILED');
      const result = await response.json();
      setMessages((current) => [...current, result.data.message]);
    } catch (err) {
      setError(err instanceof Error && err.message === 'SESSION_EXPIRED' ? '此聊天已過期。' : '檔案傳送失敗。');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const background = config?.theme.backgroundImageUrl
    ? {
        backgroundImage: `linear-gradient(rgba(255,255,255,.88), rgba(255,255,255,.94)), url(${config.theme.backgroundImageUrl})`,
        backgroundSize: config.theme.backgroundSize ?? 'cover',
        backgroundPosition: config.theme.backgroundPosition ?? 'center',
        backgroundRepeat: 'no-repeat',
      }
    : undefined;

  if (loadState === 'loading') {
    return <main className="flex min-h-screen items-center justify-center bg-muted text-sm text-muted-foreground">開啟聊天室中...</main>;
  }

  if (loadState === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className="flex max-w-sm items-center gap-3 rounded-md border border-destructive/30 bg-white p-4 text-sm text-destructive shadow-sm">
          <XCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen bg-muted" style={background}>
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-white/95 shadow-sm backdrop-blur">
        <header className="border-b border-border px-5 py-4">
          <h1 className="text-base font-semibold text-foreground">{config?.displayName ?? 'Chatbox'}</h1>
          <p className="text-xs text-muted-foreground">線上客服</p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
          {sortedMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>

        {error ? <div className="border-t border-warning/30 bg-warning-subtle px-4 py-2 text-xs text-warning">{error}</div> : null}

        <footer className="border-t border-border bg-white p-3">
          <div className="flex items-end gap-2">
            <button
              type="button"
              aria-label="Attach file"
              title="Attach file"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              className="min-h-10 flex-1 resize-none rounded-md border border-input px-3 py-2 text-sm outline-none focus:border-primary"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendText();
                }
              }}
            />
            <button
              type="button"
              aria-label="Send message"
              title="Send message"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-foreground text-white hover:bg-foreground/90 disabled:opacity-50"
              onClick={() => void sendText()}
              disabled={sending || !input.trim()}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,video/mp4,video/quicktime"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void sendMedia(file);
            }}
          />
        </footer>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatboxMessageOutput }) {
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
  return <p className="whitespace-pre-wrap break-words">{typeof payload.text === 'string' ? payload.text : ''}</p>;
}
