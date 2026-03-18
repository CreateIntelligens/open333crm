'use client';

import React, { useEffect, useState } from 'react';
import { X, Loader2, Lightbulb, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
}

export function AiSuggestPanel({ open, onClose, conversationId, onAdopt }: AiSuggestPanelProps) {
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

  return (
    <div className="absolute right-0 top-14 z-20 w-80 rounded-lg border bg-background shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">AI 建議回覆</h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-80 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : suggestions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">無法取得建議</p>
        ) : (
          suggestions.map((sug, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <p className="text-sm">{sug.text}</p>

              {/* Confidence */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  sug.confidence >= 0.8
                    ? 'bg-green-100 text-green-700'
                    : sug.confidence >= 0.5
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-red-100 text-red-700'
                }`}>
                  {Math.round(sug.confidence * 100)}%
                </span>

                {/* KB refs */}
                {sug.kmRefs && sug.kmRefs.length > 0 && (
                  <div className="flex items-center gap-1">
                    {sug.kmRefs.map((ref) => (
                      <a
                        key={ref.id}
                        href={ref.url || '#'}
                        className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        {ref.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => onAdopt(sug.text)}
              >
                採用
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
