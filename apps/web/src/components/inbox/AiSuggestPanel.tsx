'use client';

import React, { useEffect, useState } from 'react';
import { X, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

interface Suggestion {
  text: string;
  confidence: number;
  kmRefs?: Array<{ id: string; title: string; url?: string }>;
}

interface AiSuggestPanelProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onAdopt: (text: string) => void;
  /** When true, renders inline (no absolute positioning) so it can sit between message list and input */
  inline?: boolean;
}

function AiIcon({ size = 28, padding = 7 }: { size?: number; padding?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[10px]"
      style={{
        width: size,
        height: size,
        padding: `0 ${padding}px`,
        background: 'linear-gradient(135deg, #615FFF 0%, #2B7FFF 100%)',
      }}
    >
      <Sparkles className="text-white" style={{ width: size - padding * 2, height: size - padding * 2 }} />
    </span>
  );
}

export function AiSuggestPanel({ open, onClose, conversationId, onAdopt, inline = false }: AiSuggestPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSuggestions([]);
    api
      .post('/ai/suggest-reply', { conversationId })
      .then((res) => setSuggestions(res.data.data.suggestions || []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [open, conversationId]);

  if (!open) return null;

  const containerClass = inline
    ? 'shrink-0 border-t border-surface-line bg-surface-canvas px-4 py-4'
    : 'absolute right-4 top-20 z-20 w-[420px] rounded-card border border-surface-line bg-white p-4 shadow-lg';

  // AI gradient bg per Figma
  const aiCardStyle: React.CSSProperties = {
    background:
      'linear-gradient(136deg, rgba(238,243,255,1) 0%, rgba(255,255,255,1) 46%, rgba(239,246,255,1) 100%)',
    borderColor: '#C4D2FF',
  };

  return (
    <div className={containerClass}>
      <div
        className="flex flex-col gap-3 rounded-2xl border p-3 shadow-[0_0_4px_0_rgba(0,0,0,0.1)]"
        style={aiCardStyle}
      >
        {/* Top row: AI icon + title + close */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <AiIcon size={28} padding={7} />
            <div className="flex flex-col">
              <span className="text-[14px] font-semibold leading-5 text-ink">AI 建議回覆</span>
              <span className="text-[12px] leading-4 text-ink-subtle">基於對話情境和服務歷史</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-surface-line bg-white text-ink-subtle transition-colors hover:bg-neutral-20"
            aria-label="關閉"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center rounded-card border border-surface-line bg-white py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ink-subtle" />
          </div>
        ) : suggestions.length === 0 ? (
          <div className="rounded-card border border-surface-line bg-white p-6 text-center text-[14px] text-ink-subtle">
            無法取得建議
          </div>
        ) : (
          suggestions.map((sug, i) => (
            <div key={i} className="flex flex-col gap-2">
              {/* Suggestion body card */}
              <div className="rounded-card border border-surface-line bg-white p-3">
                <p className="whitespace-pre-wrap text-[14px] leading-6 text-ink">{sug.text}</p>
              </div>

              {/* Bottom row: meta + adopt button */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AiIcon size={16} padding={2} />
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold',
                      sug.confidence >= 0.8
                        ? 'bg-f-green-10 text-f-green-80'
                        : sug.confidence >= 0.5
                          ? 'bg-f-orange-10 text-f-orange-80'
                          : 'bg-f-red-10 text-f-red-80',
                    )}
                  >
                    {Math.round(sug.confidence * 100)}%
                  </span>
                  {sug.kmRefs && sug.kmRefs.length > 0 && (
                    <div className="flex min-w-0 items-center gap-1">
                      {sug.kmRefs.map((ref) => (
                        <a
                          key={ref.id}
                          href={ref.url || '#'}
                          className="inline-flex max-w-full shrink items-center gap-0.5 truncate text-[11px] text-link hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                          title={ref.title}
                        >
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{ref.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onAdopt(sug.text)}
                  className="inline-flex h-7 shrink-0 items-center justify-center rounded-3xl bg-[#378ADD] px-4 text-[12px] font-medium leading-4 text-white transition-colors hover:bg-[#2876C4]"
                >
                  採用建議
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
