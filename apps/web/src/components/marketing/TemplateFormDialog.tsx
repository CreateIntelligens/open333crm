'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Trash2, Eye } from 'lucide-react';
import api from '@/lib/api';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface TemplateVariable {
  key: string;
  label: string;
  defaultValue: string;
  required: boolean;
}

interface QuickReplyItem {
  label: string;
  text: string;
  postbackData: string;
}

interface FbButton {
  type: 'web_url' | 'postback';
  title: string;
  url?: string;
  payload?: string;
}

interface FbElement {
  title: string;
  subtitle: string;
  imageUrl: string;
  buttons: FbButton[];
}

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: {
    id?: string;
    name: string;
    description: string | null;
    category: string;
    channelType: string;
    contentType: string;
    body: Record<string, unknown>;
    variables: unknown[];
  } | null;
  onSaved: () => void;
}

const channelTypeOptions = [
  { value: 'universal', label: '通用' },
  { value: 'LINE', label: 'LINE' },
  { value: 'FB', label: 'Facebook' },
  { value: 'WEBCHAT', label: 'WebChat' },
];

const contentTypeOptions = [
  { value: 'text', label: '文字' },
  { value: 'image', label: '圖片' },
  { value: 'flex', label: 'Flex Message' },
  { value: 'quick_reply', label: '快速回覆' },
  { value: 'fb_generic', label: 'FB 通用卡片' },
  { value: 'fb_carousel', label: 'FB 輪播卡' },
];

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

function normalizeVariables(vars: unknown[]): TemplateVariable[] {
  if (!Array.isArray(vars)) return [];
  return vars.map((v: any) => ({
    key: v.key || v.name || String(v),
    label: v.label || '',
    defaultValue: v.defaultValue || '',
    required: v.required ?? false,
  }));
}

function normalizeQuickReplies(body: Record<string, unknown>): QuickReplyItem[] {
  const qr = body.quickReplies as unknown[];
  if (!Array.isArray(qr)) return [{ label: '', text: '', postbackData: '' }];
  return qr.map((item: any) => ({
    label: item.label || '',
    text: item.text || '',
    postbackData: item.postbackData || '',
  }));
}

function normalizeFbElements(body: Record<string, unknown>): FbElement[] {
  const els = body.fbElements as unknown[];
  if (!Array.isArray(els) || els.length === 0) {
    return [{ title: '', subtitle: '', imageUrl: '', buttons: [] }];
  }
  return els.map((el: any) => ({
    title: el.title || '',
    subtitle: el.subtitle || '',
    imageUrl: el.imageUrl || '',
    buttons: Array.isArray(el.buttons)
      ? el.buttons.map((b: any) => ({
          type: b.type || 'web_url',
          title: b.title || '',
          url: b.url || '',
          payload: b.payload || '',
        }))
      : [],
  }));
}

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

function clientRenderBody(body: Record<string, unknown>, vars: TemplateVariable[]): Record<string, unknown> {
  const defaults: Record<string, string> = {};
  for (const v of vars) {
    defaults[v.key] = v.defaultValue || `[${v.label || v.key}]`;
  }

  function replaceVars(val: unknown): unknown {
    if (typeof val === 'string') {
      return val.replace(PLACEHOLDER_RE, (_match, key: string) =>
        defaults[key] !== undefined ? defaults[key] : `{{${key}}}`,
      );
    }
    if (Array.isArray(val)) return val.map(replaceVars);
    if (val !== null && typeof val === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        result[k] = replaceVars(v);
      }
      return result;
    }
    return val;
  }

  return replaceVars(body) as Record<string, unknown>;
}

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: TemplateFormDialogProps) {
  const isEditing = !!template?.id;

  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    channelType: 'universal',
    contentType: 'text',
    bodyText: '',
    flexJson: '',
    quickReplies: [{ label: '', text: '', postbackData: '' }] as QuickReplyItem[],
    fbElements: [{ title: '', subtitle: '', imageUrl: '', buttons: [] }] as FbElement[],
  });
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flexError, setFlexError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Fetch categories for dropdown
  const { data: categoriesData } = useSWR(
    open ? '/marketing/templates/categories' : null,
    fetcher,
  );
  const existingCategories: string[] = categoriesData?.data || [];

  useEffect(() => {
    if (template) {
      const body = template.body || {};
      setForm({
        name: template.name,
        description: template.description || '',
        category: template.category || '',
        channelType: template.channelType || 'universal',
        contentType: template.contentType || 'text',
        bodyText: (body.text as string) || '',
        flexJson: body.flexJson ? JSON.stringify(body.flexJson, null, 2) : '',
        quickReplies: template.contentType === 'quick_reply'
          ? normalizeQuickReplies(body as Record<string, unknown>)
          : [{ label: '', text: '', postbackData: '' }],
        fbElements: (template.contentType === 'fb_generic' || template.contentType === 'fb_carousel')
          ? normalizeFbElements(body as Record<string, unknown>)
          : [{ title: '', subtitle: '', imageUrl: '', buttons: [] }],
      });
      setVariables(normalizeVariables(template.variables));
    } else {
      setForm({
        name: '',
        description: '',
        category: '',
        channelType: 'universal',
        contentType: 'text',
        bodyText: '',
        flexJson: '',
        quickReplies: [{ label: '', text: '', postbackData: '' }],
        fbElements: [{ title: '', subtitle: '', imageUrl: '', buttons: [] }],
      });
      setVariables([]);
    }
    setError(null);
    setFlexError(null);
    setPreview(null);
  }, [template, open]);

  const buildBody = (): Record<string, unknown> => {
    switch (form.contentType) {
      case 'flex': {
        let flexObj = {};
        if (form.flexJson.trim()) {
          try {
            flexObj = JSON.parse(form.flexJson);
            setFlexError(null);
          } catch {
            setFlexError('JSON 格式錯誤');
            throw new Error('Invalid JSON');
          }
        }
        return { text: form.bodyText || undefined, flexJson: flexObj };
      }
      case 'quick_reply':
        return {
          text: form.bodyText,
          quickReplies: form.quickReplies.filter((qr) => qr.label.trim()),
        };
      case 'fb_generic':
        return {
          text: form.bodyText,
          fbElements: form.fbElements.slice(0, 1).map((el) => ({
            title: el.title,
            subtitle: el.subtitle,
            imageUrl: el.imageUrl,
            buttons: el.buttons.filter((b) => b.title.trim()),
          })),
        };
      case 'fb_carousel':
        return {
          text: form.bodyText,
          fbElements: form.fbElements.map((el) => ({
            title: el.title,
            subtitle: el.subtitle,
            imageUrl: el.imageUrl,
            buttons: el.buttons.filter((b) => b.title.trim()),
          })),
        };
      case 'image':
        return { text: form.bodyText, imageUrl: '' };
      default:
        return { text: form.bodyText };
    }
  };

  const handlePreview = async () => {
    let body: Record<string, unknown>;
    try {
      body = buildBody();
    } catch {
      return;
    }

    if (isEditing) {
      // Server-side preview
      setPreviewing(true);
      try {
        const res = await api.post(`/marketing/templates/${template!.id}/preview`, {
          useSampleData: true,
        });
        setPreview(res.data.data.rendered);
      } catch (err: any) {
        setError(err.response?.data?.error?.message || '預覽失敗');
      } finally {
        setPreviewing(false);
      }
    } else {
      // Client-side preview for new templates
      const rendered = clientRenderBody(body, variables);
      setPreview(rendered);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    let body: Record<string, unknown>;
    try {
      body = buildBody();
    } catch {
      setSaving(false);
      return;
    }

    const payload = {
      name: form.name,
      description: form.description || undefined,
      category: form.category || '一般',
      channelType: form.channelType,
      contentType: form.contentType,
      body,
      variables: variables.filter((v) => v.key.trim()),
    };

    try {
      if (isEditing) {
        await api.patch(`/marketing/templates/${template!.id}`, payload);
      } else {
        await api.post('/marketing/templates', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(
        err.response?.data?.error?.message || '儲存失敗，請檢查輸入資料',
      );
    } finally {
      setSaving(false);
    }
  };

  // --- Variable list helpers ---
  const addVariable = () =>
    setVariables((v) => [...v, { key: '', label: '', defaultValue: '', required: false }]);

  const removeVariable = (idx: number) =>
    setVariables((v) => v.filter((_, i) => i !== idx));

  const updateVariable = (idx: number, field: keyof TemplateVariable, value: string | boolean) =>
    setVariables((v) =>
      v.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    );

  // --- Quick reply list helpers ---
  const addQuickReply = () =>
    setForm((f) => ({
      ...f,
      quickReplies: [...f.quickReplies, { label: '', text: '', postbackData: '' }],
    }));

  const removeQuickReply = (idx: number) =>
    setForm((f) => ({
      ...f,
      quickReplies: f.quickReplies.filter((_, i) => i !== idx),
    }));

  const updateQuickReply = (idx: number, field: keyof QuickReplyItem, value: string) =>
    setForm((f) => ({
      ...f,
      quickReplies: f.quickReplies.map((item, i) =>
        i === idx ? { ...item, [field]: value } : item,
      ),
    }));

  // --- FB element helpers ---
  const addFbElement = () =>
    setForm((f) => ({
      ...f,
      fbElements: [...f.fbElements, { title: '', subtitle: '', imageUrl: '', buttons: [] }],
    }));

  const removeFbElement = (idx: number) =>
    setForm((f) => ({
      ...f,
      fbElements: f.fbElements.filter((_, i) => i !== idx),
    }));

  const updateFbElement = (idx: number, field: keyof FbElement, value: string) =>
    setForm((f) => ({
      ...f,
      fbElements: f.fbElements.map((el, i) =>
        i === idx ? { ...el, [field]: value } : el,
      ),
    }));

  const addFbButton = (elIdx: number) =>
    setForm((f) => ({
      ...f,
      fbElements: f.fbElements.map((el, i) =>
        i === elIdx
          ? { ...el, buttons: [...el.buttons, { type: 'web_url' as const, title: '', url: '', payload: '' }] }
          : el,
      ),
    }));

  const removeFbButton = (elIdx: number, btnIdx: number) =>
    setForm((f) => ({
      ...f,
      fbElements: f.fbElements.map((el, i) =>
        i === elIdx
          ? { ...el, buttons: el.buttons.filter((_, j) => j !== btnIdx) }
          : el,
      ),
    }));

  const updateFbButton = (elIdx: number, btnIdx: number, field: string, value: string) =>
    setForm((f) => ({
      ...f,
      fbElements: f.fbElements.map((el, i) =>
        i === elIdx
          ? {
              ...el,
              buttons: el.buttons.map((btn, j) =>
                j === btnIdx ? { ...btn, [field]: value } : btn,
              ),
            }
          : el,
      ),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? '編輯範本' : '新增範本'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">名稱</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="範本名稱"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">說明</label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="範本用途說明"
              />
            </div>

            {/* Category — combo of existing + custom */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">分類</label>
              <div className="flex gap-2">
                {existingCategories.length > 0 && (
                  <Select
                    value={existingCategories.includes(form.category) ? form.category : ''}
                    onChange={(e) => {
                      if (e.target.value) setForm((f) => ({ ...f, category: e.target.value }));
                    }}
                    options={[
                      { value: '', label: '— 選擇或輸入 —' },
                      ...existingCategories.map((c) => ({ value: c, label: c })),
                    ]}
                  />
                )}
                <Input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="例：促銷、通知、問候"
                  className="flex-1"
                />
              </div>
            </div>

            {/* Channel Type + Content Type */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">渠道類型</label>
                <Select
                  value={form.channelType}
                  onChange={(e) => setForm((f) => ({ ...f, channelType: e.target.value }))}
                  options={channelTypeOptions}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">內容類型</label>
                <Select
                  value={form.contentType}
                  onChange={(e) => setForm((f) => ({ ...f, contentType: e.target.value }))}
                  options={contentTypeOptions}
                />
              </div>
            </div>

            {/* Body Editor — dynamic by contentType */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">訊息內容</label>
              <Textarea
                value={form.bodyText}
                onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
                placeholder="輸入訊息內容，可使用 {{變數名稱}} 作為動態內容"
                rows={form.contentType === 'text' ? 6 : 3}
                required={form.contentType !== 'flex' && form.contentType !== 'fb_generic' && form.contentType !== 'fb_carousel'}
              />
            </div>

            {/* Flex JSON editor */}
            {form.contentType === 'flex' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Flex JSON</label>
                <Textarea
                  value={form.flexJson}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, flexJson: e.target.value }));
                    setFlexError(null);
                  }}
                  placeholder='{"type":"bubble","body":{"type":"box",...}}'
                  rows={8}
                  className="font-mono text-xs"
                  required
                />
                {flexError && (
                  <p className="mt-1 text-xs text-destructive">{flexError}</p>
                )}
              </div>
            )}

            {/* Quick Reply editor */}
            {form.contentType === 'quick_reply' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">快速回覆選項</label>
                  <Button type="button" variant="outline" size="sm" onClick={addQuickReply}>
                    <Plus className="mr-1 h-3 w-3" />
                    新增
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.quickReplies.map((qr, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={qr.label}
                        onChange={(e) => updateQuickReply(idx, 'label', e.target.value)}
                        placeholder="按鈕文字"
                        className="flex-1"
                      />
                      <Input
                        value={qr.text}
                        onChange={(e) => updateQuickReply(idx, 'text', e.target.value)}
                        placeholder="回覆文字"
                        className="flex-1"
                      />
                      <Input
                        value={qr.postbackData}
                        onChange={(e) => updateQuickReply(idx, 'postbackData', e.target.value)}
                        placeholder="Postback"
                        className="flex-1"
                      />
                      {form.quickReplies.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeQuickReply(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FB Generic editor (single element) */}
            {form.contentType === 'fb_generic' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">FB 通用卡片</label>
                {form.fbElements.slice(0, 1).map((el, elIdx) => (
                  <FbElementEditor
                    key={elIdx}
                    element={el}
                    index={elIdx}
                    onUpdate={updateFbElement}
                    onAddButton={addFbButton}
                    onRemoveButton={removeFbButton}
                    onUpdateButton={updateFbButton}
                  />
                ))}
              </div>
            )}

            {/* FB Carousel editor (multiple elements) */}
            {form.contentType === 'fb_carousel' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">FB 輪播卡片</label>
                  <Button type="button" variant="outline" size="sm" onClick={addFbElement}>
                    <Plus className="mr-1 h-3 w-3" />
                    新增卡片
                  </Button>
                </div>
                <div className="space-y-4">
                  {form.fbElements.map((el, elIdx) => (
                    <div key={elIdx} className="relative rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          卡片 {elIdx + 1}
                        </span>
                        {form.fbElements.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFbElement(elIdx)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <FbElementEditor
                        element={el}
                        index={elIdx}
                        onUpdate={updateFbElement}
                        onAddButton={addFbButton}
                        onRemoveButton={removeFbButton}
                        onUpdateButton={updateFbButton}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Structured Variables */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">變數定義</label>
                <Button type="button" variant="outline" size="sm" onClick={addVariable}>
                  <Plus className="mr-1 h-3 w-3" />
                  新增變數
                </Button>
              </div>
              {variables.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  尚未定義變數。在訊息內容中使用 {'{{變數名稱}}'} 語法，並在此定義變數屬性。
                </p>
              ) : (
                <div className="space-y-2">
                  {variables.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={v.key}
                        onChange={(e) => updateVariable(idx, 'key', e.target.value)}
                        placeholder="key（如 contact.name）"
                        className="flex-1"
                      />
                      <Input
                        value={v.label}
                        onChange={(e) => updateVariable(idx, 'label', e.target.value)}
                        placeholder="顯示名稱"
                        className="flex-1"
                      />
                      <Input
                        value={v.defaultValue}
                        onChange={(e) => updateVariable(idx, 'defaultValue', e.target.value)}
                        placeholder="預設值"
                        className="w-24"
                      />
                      <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={v.required}
                          onChange={(e) => updateVariable(idx, 'required', e.target.checked)}
                          className="rounded"
                        />
                        必填
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeVariable(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Preview result */}
            {preview && (
              <div className="rounded-md border bg-muted/50 p-3">
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">預覽結果</h4>
                {typeof preview === 'object' && (preview as Record<string, unknown>).text ? (
                  <p className="mb-2 whitespace-pre-wrap text-sm">
                    {(preview as Record<string, unknown>).text as string}
                  </p>
                ) : null}
                {typeof preview === 'object' &&
                  ((preview as Record<string, unknown>).flexJson ||
                    (preview as Record<string, unknown>).fbElements ||
                    (preview as Record<string, unknown>).quickReplies) ? (
                  <pre className="whitespace-pre-wrap text-xs font-mono bg-muted rounded p-2 max-h-60 overflow-auto">
                    {JSON.stringify(
                      (preview as Record<string, unknown>).flexJson ||
                      (preview as Record<string, unknown>).fbElements ||
                      (preview as Record<string, unknown>).quickReplies,
                      null,
                      2,
                    )}
                  </pre>
                ) : null}
                {typeof preview === 'object' &&
                  !(preview as Record<string, unknown>).flexJson &&
                  !(preview as Record<string, unknown>).fbElements &&
                  !(preview as Record<string, unknown>).quickReplies &&
                  !(preview as Record<string, unknown>).text ? (
                  <pre className="whitespace-pre-wrap text-sm">
                    {JSON.stringify(preview, null, 2)}
                  </pre>
                ) : null}
                {typeof preview !== 'object' && (
                  <pre className="whitespace-pre-wrap text-sm">{String(preview)}</pre>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreview}
              disabled={previewing}
            >
              {previewing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Eye className="mr-2 h-4 w-4" />
              )}
              預覽
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  儲存中...
                </>
              ) : (
                '儲存'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- FB Element sub-editor ---
function FbElementEditor({
  element,
  index,
  onUpdate,
  onAddButton,
  onRemoveButton,
  onUpdateButton,
}: {
  element: FbElement;
  index: number;
  onUpdate: (idx: number, field: keyof FbElement, value: string) => void;
  onAddButton: (elIdx: number) => void;
  onRemoveButton: (elIdx: number, btnIdx: number) => void;
  onUpdateButton: (elIdx: number, btnIdx: number, field: string, value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Input
        value={element.title}
        onChange={(e) => onUpdate(index, 'title', e.target.value)}
        placeholder="標題"
      />
      <Input
        value={element.subtitle}
        onChange={(e) => onUpdate(index, 'subtitle', e.target.value)}
        placeholder="副標題"
      />
      <Input
        value={element.imageUrl}
        onChange={(e) => onUpdate(index, 'imageUrl', e.target.value)}
        placeholder="圖片網址"
      />
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">按鈕</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onAddButton(index)}>
            <Plus className="mr-1 h-3 w-3" />
            新增按鈕
          </Button>
        </div>
        {element.buttons.map((btn, btnIdx) => (
          <div key={btnIdx} className="mb-1.5 flex items-center gap-2">
            <Select
              value={btn.type}
              onChange={(e) => onUpdateButton(index, btnIdx, 'type', e.target.value)}
              options={[
                { value: 'web_url', label: '網址' },
                { value: 'postback', label: 'Postback' },
              ]}
              className="w-28"
            />
            <Input
              value={btn.title}
              onChange={(e) => onUpdateButton(index, btnIdx, 'title', e.target.value)}
              placeholder="按鈕文字"
              className="flex-1"
            />
            {btn.type === 'web_url' ? (
              <Input
                value={btn.url || ''}
                onChange={(e) => onUpdateButton(index, btnIdx, 'url', e.target.value)}
                placeholder="網址"
                className="flex-1"
              />
            ) : (
              <Input
                value={btn.payload || ''}
                onChange={(e) => onUpdateButton(index, btnIdx, 'payload', e.target.value)}
                placeholder="Payload"
                className="flex-1"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onRemoveButton(index, btnIdx)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
