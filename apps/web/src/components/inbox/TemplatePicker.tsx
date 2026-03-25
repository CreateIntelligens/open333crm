'use client';

import React, { useState } from 'react';
import { X, Search, ArrowLeft, Send } from 'lucide-react';
import { useTemplates } from '@/hooks/useTemplates';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

interface TemplateVariable {
  key: string;
  label?: string;
  defaultValue?: string;
  required?: boolean;
}

interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  contentType: string;
  body: Record<string, unknown>;
  variables: TemplateVariable[];
}

interface TemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (text: string) => void;
  channelType?: string;
}

const CATEGORY_TABS = [
  { value: '', label: '全部' },
  { value: '一般', label: '一般' },
  { value: '服務類', label: '服務類' },
  { value: '行銷類', label: '行銷類' },
  { value: '產品資訊類', label: '產品資訊' },
  { value: '互動類', label: '互動類' },
  { value: 'FB模板', label: 'FB' },
  { value: '問候', label: '問候' },
];

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

function extractKeys(body: unknown): string[] {
  const keys = new Set<string>();
  function walk(val: unknown) {
    if (typeof val === 'string') {
      let m: RegExpExecArray | null;
      const re = new RegExp(PLACEHOLDER_RE.source, 'g');
      while ((m = re.exec(val)) !== null) {
        keys.add(m[1]);
      }
    } else if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val !== null && typeof val === 'object') {
      Object.values(val).forEach(walk);
    }
  }
  walk(body);
  return Array.from(keys);
}

function renderText(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (_match, key: string) =>
    vars[key] !== undefined ? vars[key] : `{{${key}}}`,
  );
}

function getBodyText(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    return ((body as Record<string, unknown>).text as string) || '';
  }
  return String(body || '');
}

export function TemplatePicker({ open, onClose, onSelect, channelType }: TemplatePickerProps) {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TemplateItem | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  const { templates, isLoading } = useTemplates({
    category: category || undefined,
    channelType: channelType || undefined,
    q: search || undefined,
  });

  if (!open) return null;

  const handleSelectTemplate = (tpl: TemplateItem) => {
    const keys = extractKeys(tpl.body);
    if (keys.length === 0) {
      // No variables — direct insert
      onSelect(getBodyText(tpl.body));
      onClose();
      return;
    }
    // Has variables — show input stage
    setSelected(tpl);
    // Pre-fill defaults
    const defaults: Record<string, string> = {};
    if (Array.isArray(tpl.variables)) {
      for (const v of tpl.variables) {
        if (v.defaultValue) defaults[v.key] = v.defaultValue;
      }
    }
    setVarValues(defaults);
  };

  const handleInsert = () => {
    if (!selected) return;
    const text = getBodyText(selected.body);
    const rendered = renderText(text, varValues);
    onSelect(rendered);
    setSelected(null);
    setVarValues({});
    onClose();
  };

  const handleBack = () => {
    setSelected(null);
    setVarValues({});
  };

  // Get variable labels from template variable definitions
  const getVarLabel = (key: string): string => {
    if (selected?.variables) {
      const def = selected.variables.find((v) => v.key === key);
      if (def?.label) return def.label;
    }
    return key;
  };

  // --- Stage 2: Variable input ---
  if (selected) {
    const keys = extractKeys(selected.body);
    const previewText = renderText(getBodyText(selected.body), varValues);

    return (
      <div className="absolute bottom-0 left-0 right-0 z-30 flex max-h-[60%] flex-col rounded-t-lg border-t bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <button onClick={handleBack} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h3 className="text-sm font-semibold">{selected.name}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Variable inputs */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">填入變數值：</p>
            {keys.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <label className="min-w-[120px] text-sm text-muted-foreground">
                  {getVarLabel(key)}
                </label>
                <Input
                  value={varValues[key] || ''}
                  onChange={(e) =>
                    setVarValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                  placeholder={`輸入 ${getVarLabel(key)}`}
                  className="flex-1"
                />
              </div>
            ))}
          </div>

          {/* Preview */}
          <div className="rounded-md border bg-muted/50 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">預覽</p>
            <p className="whitespace-pre-wrap text-sm">{previewText}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2 flex justify-end">
          <Button size="sm" onClick={handleInsert}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            插入
          </Button>
        </div>
      </div>
    );
  }

  // --- Stage 1: Template list ---
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
          templates.map((tpl: TemplateItem) => {
            const bodyText = getBodyText(tpl.body);
            const hasVars = extractKeys(tpl.body).length > 0;

            return (
              <button
                key={tpl.id}
                onClick={() => handleSelectTemplate(tpl)}
                className="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tpl.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {tpl.category}
                  </Badge>
                  {hasVars && (
                    <Badge variant="outline" className="text-[10px]">
                      含變數
                    </Badge>
                  )}
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
