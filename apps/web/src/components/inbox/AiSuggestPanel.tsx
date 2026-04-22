'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Lightbulb, ExternalLink } from 'lucide-react';
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
    if (!open) { return; }
    setLoading(true);
    setSuggestions([]);
    api
      .post('/ai/suggest-reply', { conversationId })
      .then((res) => setSuggestions(res.data.data.suggestions || []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [open, conversationId]);

  if (!open) { return null; }

  const topSuggestion = suggestions[0];

  return (
    <div className="mx-4 mb-4 rounded-xl border border-[#cb74c1]/30 bg-[#f8eaf6] p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center rounded-full bg-[#cb74c1]/10 p-1.5">
          <Lightbulb className="h-4 w-4 text-[#cb74c1]" />
        </div>
        <h3 className="text-sm font-semibold text-[#1e2939]">AI 建議回覆</h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !topSuggestion ? (
        <p className="text-sm text-muted-foreground text-center py-3">無法取得建議</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-[#1e2939]">{topSuggestion.text}</p>

          {topSuggestion.kmRefs && topSuggestion.kmRefs.length > 0 && (
            <div className="flex items-center gap-1">
              {topSuggestion.kmRefs.map((ref) => (
                <a
                  key={ref.id}
                  href={ref.url || '#'}
                  className="inline-flex items-center gap-0.5 text-[10px] text-[#4a5565] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  {ref.title}
                </a>
              ))}
            </div>
          )}

          <Button
            size="sm"
            className="w-full bg-[#cb74c1] text-white hover:bg-[#cb74c1]/90 rounded-lg text-xs h-8"
            onClick={() => onAdopt(topSuggestion.text)}
          >
            採用建議
          </Button>
        </div>
      )}
    </div>
  );
}
