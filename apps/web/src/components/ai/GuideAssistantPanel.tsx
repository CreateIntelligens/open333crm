'use client';

/**
 * 後台助理面板（規格 dashboard-guide-assistant）。後台每一頁的右下角有助理按鈕，打開後可以提問。
 *
 * - 只在員工有 assistant.use 時顯示。
 * - 回答有導覽時顯示「帶我去」。員工按下按鈕後才執行導覽：面板收起，畫面切到功能頁，
 *   每一步標示元素並顯示說明卡，員工操作完再進行下一步。
 * - 對話只存在這個元件的 state，關閉面板後清空。每次提問送出最近 6 則訊息當作上下文。
 */
import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, MessageCircleQuestion, Send, X } from 'lucide-react';
import type { GuideDefinition, GuideStep } from '@open333crm/shared';
import { splitTextLinks } from '@open333crm/shared';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { usePermission } from '@/providers/AuthProvider';
import { runGuide, type GuideStepProgress } from '@/lib/guide/guide-runner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { GuideSpotlight } from './GuideSpotlight';

interface AssistantReply {
  answer: string;
  guide: GuideDefinition | null;
  sources: Array<{ id: string; title: string }>;
}

type ChatItem =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; guide?: GuideDefinition | null; sources?: AssistantReply['sources'] }
  | { role: 'notice'; content: string };

const HISTORY_LIMIT = 6;
/** 與 API 的 history 每則上限相同（guide-assistant.routes.ts） */
const HISTORY_CONTENT_MAX = 2000;
const NOT_FOUND_NOTICE = '找不到這個欄位，請依上面的步驟操作。';

/** 只接受 http(s) 網址，回傳 URL 解析後的網址；其他協定（javascript: 等）回 null */
function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** 答案裡的網址顯示成連結。只認 http(s)，其他文字維持純文字 */
function AnswerText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-foreground">
      {splitTextLinks(text).map((part, i) => {
        const href = part.type === 'link' ? safeHttpUrl(part.value) : null;
        return href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {part.value}
          </a>
        ) : (
          <React.Fragment key={i}>{part.value}</React.Fragment>
        );
      })}
    </p>
  );
}

export function GuideAssistantPanel() {
  // 答案來自知識庫文章，API 同時要求兩個權限
  // 兩個 hook 都無條件呼叫：用 && 串接時，第一個是 false 就不呼叫第二個，違反 hook 規則
  const canUseAssistant = usePermission('assistant.use');
  const canViewKnowledge = usePermission('knowledge.view');
  const canUse = canUseAssistant && canViewKnowledge;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [spotlight, setSpotlight] = useState<{
    el: HTMLElement;
    step: GuideStep;
    progress: GuideStepProgress;
    next: () => void;
    cancel: () => void;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 每次關閉面板加一。請求回來時編號不同，代表對話已清空，丟掉這個回覆 */
  const sessionRef = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [items, open]);

  if (!canUse) return null;

  const close = () => {
    sessionRef.current += 1;
    setSending(false);
    setOpen(false);
    setItems([]);
    setInput('');
  };

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    const history = items
      .filter((i): i is Extract<ChatItem, { role: 'user' | 'assistant' }> => i.role !== 'notice')
      .slice(-HISTORY_LIMIT)
      .map((i) => ({ role: i.role, content: i.content.slice(0, HISTORY_CONTENT_MAX) }));
    const session = sessionRef.current;
    setItems((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await api.post('/ai/guide-assistant/ask', { message, history, currentPath: pathname });
      if (session !== sessionRef.current) return;
      const reply = res.data.data as AssistantReply;
      setItems((prev) => [...prev, { role: 'assistant', content: reply.answer, guide: reply.guide, sources: reply.sources }]);
    } catch (err) {
      if (session !== sessionRef.current) return;
      setItems((prev) => [...prev, { role: 'notice', content: getApiErrorMessage(err, '助理暫時無法回答，請稍後再試') }]);
    } finally {
      if (session === sessionRef.current) setSending(false);
    }
  };

  const go = async (guide: GuideDefinition) => {
    // 面板收起，避免蓋住要標示的欄位；對話保留，導覽失敗時再打開
    const session = sessionRef.current;
    setOpen(false);
    const result = await runGuide(guide, {
      currentPath: pathname,
      getPath: () => window.location.pathname,
      navigate: (route) => router.push(route),
      showStep: (el, step, progress) =>
        new Promise((resolve) => {
          // 同一步只回一次：元素點擊與元素移除可能先後觸發
          let done = false;
          const finish = (outcome: 'next' | 'cancel') => {
            if (done) return;
            done = true;
            setSpotlight(null);
            resolve(outcome);
          };
          setSpotlight({ el, step, progress, next: () => finish('next'), cancel: () => finish('cancel') });
        }),
    });
    // 員工自己結束導覽時不顯示訊息；導覽期間員工關閉了面板（對話已清空）時，不再打開面板
    if (!result.ok && result.reason === 'missing' && session === sessionRef.current) {
      setItems((prev) => [...prev, { role: 'notice', content: NOT_FOUND_NOTICE }]);
      setOpen(true);
    }
  };

  // 開發環境右下角已有訊息模擬器的按鈕（SimulatorPanel），助理按鈕往上移
  const anchor = process.env.NODE_ENV === 'development' ? 'bottom-24 right-6' : 'bottom-6 right-6';

  return (
    <>
      {!open && (
        <Button
          aria-label="開啟助理"
          className={cn('fixed z-50 h-12 w-12 rounded-full p-0 shadow-lg', anchor)}
          onClick={() => setOpen(true)}
        >
          <MessageCircleQuestion className="!size-6" />
        </Button>
      )}

      {open && (
        <section
          aria-label="後台助理"
          className={cn(
            'fixed z-50 flex h-[560px] max-h-[calc(100vh-48px)] w-[380px] flex-col rounded-xl border border-border bg-background shadow-lg',
            anchor,
          )}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">後台助理</h2>
              <p className="text-xs text-muted-foreground">問我怎麼操作，我帶你到功能頁</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="關閉助理" onClick={close}>
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">例如：怎麼設定關鍵字自動回覆？怎麼新增客服人員？</p>
            )}
            {items.map((item, i) => {
              if (item.role === 'user') {
                return (
                  <div key={i} className="ml-8 rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                    <p className="whitespace-pre-wrap break-words">{item.content}</p>
                  </div>
                );
              }
              if (item.role === 'notice') {
                return (
                  <p key={i} role="status" className="text-sm text-destructive">
                    {item.content}
                  </p>
                );
              }
              return (
                <div key={i} className="mr-4 space-y-2 rounded-xl bg-muted px-3 py-2">
                  <AnswerText text={item.content} />
                  {item.sources && item.sources.length > 0 && (
                    <p className="text-xs text-muted-foreground">參考文章：{item.sources.map((s) => s.title).join('、')}</p>
                  )}
                  {item.guide && (
                    <Button size="xs" onClick={() => go(item.guide!)}>
                      帶我去
                    </Button>
                  )}
                </div>
              );
            })}
            {sending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                查詢中
              </p>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Textarea
              aria-label="輸入問題"
              value={input}
              maxLength={1000}
              rows={2}
              className="min-h-[48px] resize-none"
              placeholder="輸入你的問題"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter 送出，Shift+Enter 換行；輸入法選字中的 Enter 不送出
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button type="submit" size="icon" aria-label="送出問題" disabled={sending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </section>
      )}

      {spotlight && (
        <GuideSpotlight
          target={spotlight.el}
          step={spotlight.step}
          progress={spotlight.progress}
          onNext={spotlight.next}
          onClose={spotlight.cancel}
        />
      )}
    </>
  );
}
