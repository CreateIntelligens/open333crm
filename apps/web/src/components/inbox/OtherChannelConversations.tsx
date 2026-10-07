"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { ChannelLabel } from "@/components/shared/ChannelLabel";
import { Separator } from "@/components/ui/separator";

interface ConversationRow {
  id: string;
  channelType: string;
  channel?: { displayName?: string | null } | null;
  lastMessageAt?: string | null;
  lastMessage?: {
    content?: { text?: string } | null;
    contentType?: string;
  } | null;
}

interface MessageRow {
  id: string;
  direction: string;
  contentType: string;
  content?: { text?: string } | null;
  createdAt: string;
}

/** 非文字訊息只顯示類型，不顯示內容 */
function messageText(m: {
  contentType?: string;
  content?: { text?: string } | null;
}): string {
  if (m.content?.text) return m.content.text;
  const labels: Record<string, string> = {
    image: "[圖片]",
    video: "[影片]",
    audio: "[語音]",
    file: "[檔案]",
    sticker: "[貼圖]",
  };
  return labels[m.contentType ?? ""] ?? "[非文字訊息]";
}

const formatTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("zh-TW", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

/**
 * 收件匣右側面板：同一位聯絡人在其他渠道的對話（change add-email-identity-merge）。
 * 只列出客服看得到的渠道；看不到的只顯示數量。展開時讀取該對話最近 20 則訊息。
 * 沒有內容時整個區塊（含下方分隔線）不顯示。
 */
export function OtherChannelConversations({
  contactId,
  currentConversationId,
}: {
  contactId: string;
  currentConversationId: string;
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Record<string, MessageRow[] | "loading" | { error: string }>
  >({});

  useEffect(() => {
    let cancelled = false;
    setExpanded(null);
    setError(null);
    api
      .get(`/contacts/${contactId}/conversations?limit=20`)
      .then((res) => {
        if (cancelled) return;
        const rows = (res.data?.data ?? []) as ConversationRow[];
        setConversations(rows.filter((c) => c.id !== currentConversationId));
        setHiddenCount(Number(res.data?.meta?.hiddenCount ?? 0));
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            getApiErrorMessage(err, "其他渠道的對話載入失敗，請重新整理"),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, currentConversationId]);

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (Array.isArray(messages[id])) return;
    setMessages((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const res = await api.get(
        `/conversations/${id}/messages?limit=20&order=desc`,
      );
      const rows = ((res.data?.data ?? []) as MessageRow[]).slice().reverse();
      setMessages((prev) => ({ ...prev, [id]: rows }));
    } catch (err) {
      setMessages((prev) => ({
        ...prev,
        [id]: { error: getApiErrorMessage(err, "訊息載入失敗，請稍後重試") },
      }));
    }
  };

  if (error) {
    return (
      <>
        <div className="p-4">
          <p className="text-xs text-destructive">
            其他渠道的對話載入失敗：{error}
          </p>
        </div>
        <Separator />
      </>
    );
  }
  if (conversations.length === 0 && hiddenCount === 0) return null;

  return (
    <>
      <div className="p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          其他渠道的對話
        </h4>
        <div className="flex flex-col gap-1.5">
          {conversations.map((c) => {
            const open = expanded === c.id;
            const state = messages[c.id];
            return (
              <div key={c.id} className="rounded-md border border-border">
                <button
                  type="button"
                  className="flex w-full items-start gap-1.5 p-2 text-left hover:bg-muted/50"
                  aria-expanded={open}
                  onClick={() => toggle(c.id)}
                >
                  {open ? (
                    <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <ChannelLabel
                        channelType={c.channelType}
                        channelName={c.channel?.displayName}
                        nameClassName="max-w-[8rem]"
                      />
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatTime(c.lastMessageAt)}
                      </span>
                    </span>
                    {c.lastMessage && (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {messageText(c.lastMessage)}
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto border-t border-border p-2">
                    {state === "loading" && (
                      <p className="text-xs text-muted-foreground">載入中...</p>
                    )}
                    {state && !Array.isArray(state) && state !== "loading" && (
                      <p className="text-xs text-destructive">{state.error}</p>
                    )}
                    {Array.isArray(state) && state.length === 0 && (
                      <p className="text-xs text-muted-foreground">沒有訊息</p>
                    )}
                    {Array.isArray(state) &&
                      state.map((m) => (
                        <div
                          key={m.id}
                          data-testid="other-channel-message"
                          className={
                            m.direction === "INBOUND"
                              ? "text-left"
                              : "text-right"
                          }
                        >
                          <span
                            className={`inline-block max-w-[90%] whitespace-pre-wrap break-words rounded-md px-2 py-1 text-xs ${
                              m.direction === "INBOUND"
                                ? "bg-muted"
                                : "bg-primary-subtle"
                            }`}
                          >
                            {messageText(m)}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {formatTime(m.createdAt)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <p className="text-xs text-muted-foreground">
              另有 {hiddenCount} 段其他渠道的對話，你沒有權限查看
            </p>
          )}
        </div>
      </div>
      <Separator />
    </>
  );
}
