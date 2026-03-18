'use client';

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
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

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: {
    id: string;
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
];

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: TemplateFormDialogProps) {
  const isEditing = !!template;

  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    channelType: 'universal',
    contentType: 'text',
    bodyText: '',
    variables: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (template) {
      const body = template.body || {};
      setForm({
        name: template.name,
        description: template.description || '',
        category: template.category || '',
        channelType: template.channelType || 'universal',
        contentType: template.contentType || 'text',
        bodyText: (body.text as string) || JSON.stringify(body),
        variables: Array.isArray(template.variables)
          ? template.variables.map((v: any) => v.name || v).join(', ')
          : '',
      });
    } else {
      setForm({
        name: '',
        description: '',
        category: '',
        channelType: 'universal',
        contentType: 'text',
        bodyText: '',
        variables: '',
      });
    }
    setError(null);
  }, [template, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const variables = form.variables
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((name) => ({ name, type: 'string' }));

    const body =
      form.contentType === 'text'
        ? { text: form.bodyText }
        : { text: form.bodyText, imageUrl: '' };

    const payload = {
      name: form.name,
      description: form.description || undefined,
      category: form.category || '一般',
      channelType: form.channelType,
      contentType: form.contentType,
      body,
      variables,
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
        err.response?.data?.error?.message || '儲存失敗，請檢查輸入資料'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? '編輯範本' : '新增範本'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">名稱</label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="範本名稱"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">說明</label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="範本用途說明"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">分類</label>
              <Input
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
                placeholder="例：促銷、通知、問候"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  渠道類型
                </label>
                <Select
                  value={form.channelType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, channelType: e.target.value }))
                  }
                  options={channelTypeOptions}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  內容類型
                </label>
                <Select
                  value={form.contentType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contentType: e.target.value }))
                  }
                  options={contentTypeOptions}
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                訊息內容
              </label>
              <Textarea
                value={form.bodyText}
                onChange={(e) =>
                  setForm((f) => ({ ...f, bodyText: e.target.value }))
                }
                placeholder="輸入訊息內容，可使用 {{變數名稱}} 作為動態內容"
                rows={6}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                變數定義
              </label>
              <Input
                value={form.variables}
                onChange={(e) =>
                  setForm((f) => ({ ...f, variables: e.target.value }))
                }
                placeholder="以逗號分隔，例：customerName, orderNumber"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                定義訊息中使用的變數名稱
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
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
