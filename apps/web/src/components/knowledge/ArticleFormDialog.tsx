'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Eye, Pencil } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface ArticleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  article?: {
    id: string;
    title: string;
    summary: string;
    content: string;
    category: string;
    tags: string[];
  } | null;
  onSaved: () => void;
}

export function ArticleFormDialog({
  open,
  onOpenChange,
  article,
  onSaved,
}: ArticleFormDialogProps) {
  const isEditing = !!article;

  const [form, setForm] = useState({
    title: '',
    summary: '',
    content: '',
    category: '',
    tags: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    if (article) {
      setForm({
        title: article.title,
        summary: article.summary || '',
        content: article.content || '',
        category: article.category || '',
        tags: (article.tags || []).join(', '),
      });
    } else {
      setForm({
        title: '',
        summary: '',
        content: '',
        category: '',
        tags: '',
      });
    }
    setError(null);
    setPreviewMode(false);
  }, [article, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (isEditing) {
        await api.patch(`/knowledge/${article!.id}`, {
          title: form.title,
          summary: form.summary,
          content: form.content,
          category: form.category || '一般',
          tags,
        });
      } else {
        await api.post('/knowledge', {
          title: form.title,
          summary: form.summary,
          content: form.content,
          category: form.category || '一般',
          tags,
        });
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
          <DialogTitle>{isEditing ? '編輯文章' : '新增文章'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">標題</label>
              <Input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="文章標題"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">分類</label>
              <Input
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
                placeholder="例：常見問題、產品說明"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">摘要</label>
              <Textarea
                value={form.summary}
                onChange={(e) =>
                  setForm((f) => ({ ...f, summary: e.target.value }))
                }
                placeholder="簡短描述文章內容..."
                rows={2}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium">內容</label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setPreviewMode((p) => !p)}
                >
                  {previewMode ? (
                    <><Pencil className="h-3 w-3" /> 編輯</>
                  ) : (
                    <><Eye className="h-3 w-3" /> 預覽</>
                  )}
                </button>
              </div>
              {previewMode ? (
                <div className="min-h-[200px] whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                  {form.content || '（空白）'}
                </div>
              ) : (
                <Textarea
                  value={form.content}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, content: e.target.value }))
                  }
                  placeholder="文章內容（支援 Markdown 格式）..."
                  rows={8}
                  required
                />
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">標籤</label>
              <Input
                value={form.tags}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tags: e.target.value }))
                }
                placeholder="以逗號分隔，例：退貨, 退款, 政策"
              />
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
