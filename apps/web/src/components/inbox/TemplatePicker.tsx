'use client';

import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import { useTemplates } from '@/hooks/useTemplates';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (text: string) => void;
  channelType?: string;
}

const CATEGORY_TABS = [
  { value: '', label: '全部' },
  { value: 'service', label: '服務類' },
  { value: 'marketing', label: '行銷類' },
  { value: 'general', label: '通用' },
  { value: 'interactive', label: '互動類' },
];

export function TemplatePicker({ open, onClose, onSelect, channelType }: TemplatePickerProps) {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  const { templates, isLoading } = useTemplates({
    category: category || undefined,
    channelType: channelType || undefined,
    q: search || undefined,
  });

  if (!open) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 flex max-h-[50%] flex-col rounded-t-lg border-t bg-background shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-semibold">選擇模板</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜尋模板..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-4">
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="w-full">
            {CATEGORY_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Template List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">沒有找到模板</p>
        ) : (
          templates.map((tpl: { id: string; name: string; description?: string; category: string; body: { text?: string } | string }) => {
            const bodyText =
              typeof tpl.body === 'object' && tpl.body !== null
                ? (tpl.body as { text?: string }).text || ''
                : String(tpl.body || '');

            return (
              <button
                key={tpl.id}
                onClick={() => {
                  onSelect(bodyText);
                  onClose();
                }}
                className="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tpl.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {tpl.category}
                  </Badge>
                </div>
                {tpl.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{tpl.description}</p>
                )}
                <p className="mt-1 truncate text-xs text-muted-foreground/70">{bodyText}</p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
