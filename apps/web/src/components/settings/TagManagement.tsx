'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface Tag {
  id: string;
  name: string;
  color: string;
  type: string;
  scope: string;
  description?: string;
}

const SCOPE_OPTIONS = [
  { value: 'CONTACT', label: '聯繫人' },
  { value: 'CONVERSATION', label: '對話' },
  { value: 'CASE', label: '案件' },
];

const TYPE_OPTIONS = [
  { value: 'MANUAL', label: '手動' },
  { value: 'AUTO', label: '自動' },
  { value: 'SYSTEM', label: '系統' },
  { value: 'CHANNEL', label: '渠道' },
];

const SCOPE_LABELS: Record<string, string> = {
  CONTACT: '聯繫人',
  CONVERSATION: '對話',
  CASE: '案件',
};

const TYPE_LABELS: Record<string, string> = {
  MANUAL: '手動',
  AUTO: '自動',
  SYSTEM: '系統',
  CHANNEL: '渠道',
};

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6b7280',
];

export function TagManagement() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [filterScope, setFilterScope] = useState<string>('ALL');

  // Form
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#6366f1');
  const [formType, setFormType] = useState('MANUAL');
  const [formScope, setFormScope] = useState('CONTACT');
  const [formDescription, setFormDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.get('/tags');
      setTags(res.data.data || []);
    } catch {
      console.error('Failed to fetch tags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const filtered = filterScope === 'ALL'
    ? tags
    : tags.filter((t) => t.scope === filterScope);

  const openCreate = () => {
    setEditingTag(null);
    setFormName('');
    setFormColor('#6366f1');
    setFormType('MANUAL');
    setFormScope('CONTACT');
    setFormDescription('');
    setError('');
    setShowDialog(true);
  };

  const openEdit = (tag: Tag) => {
    setEditingTag(tag);
    setFormName(tag.name);
    setFormColor(tag.color);
    setFormType(tag.type);
    setFormScope(tag.scope);
    setFormDescription(tag.description || '');
    setError('');
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('請輸入標籤名稱');
      return;
    }
    setSaving(true);
    setError('');

    try {
      if (editingTag) {
        await api.patch(`/tags/${editingTag.id}`, {
          name: formName.trim(),
          color: formColor,
          description: formDescription.trim() || undefined,
        });
      } else {
        await api.post('/tags', {
          name: formName.trim(),
          color: formColor,
          type: formType,
          scope: formScope,
          description: formDescription.trim() || undefined,
        });
      }
      setShowDialog(false);
      fetchTags();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此標籤嗎？已套用的聯繫人標籤也會一併移除。')) { return; }
    try {
      await api.delete(`/tags/${id}`);
      fetchTags();
    } catch {
      console.error('Failed to delete tag');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">標籤管理</h2>
          <p className="text-sm text-muted-foreground">
            管理聯繫人、對話和案件的分類標籤
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          新增標籤
        </Button>
      </div>

      {/* Scope filter */}
      <div className="flex gap-2">
        {(['ALL', 'CONTACT', 'CONVERSATION', 'CASE'] as const).map((scope) => (
          <button
            key={scope}
            onClick={() => setFilterScope(scope)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filterScope === scope
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {scope === 'ALL' ? '全部' : SCOPE_LABELS[scope]}{' '}
            {scope === 'ALL' ? tags.length : tags.filter((t) => t.scope === scope).length}
          </button>
        ))}
      </div>

      {/* Tag list */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Badge color={tag.color} className="shrink-0">{tag.name}</Badge>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    {SCOPE_LABELS[tag.scope]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {TYPE_LABELS[tag.type]}
                  </span>
                </div>
                {tag.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {tag.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button size="sm" variant="ghost" onClick={() => openEdit(tag)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(tag.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
            尚未建立標籤
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTag ? '編輯標籤' : '新增標籤'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">標籤名稱</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例：VIP"
              />
            </div>

            {/* Color picker */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">顏色</label>
              <div className="flex items-center gap-2">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormColor(c)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${
                      formColor === c ? 'scale-110 border-foreground' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <Input
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer p-0 border-0"
                />
              </div>
            </div>

            {!editingTag && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">適用範圍</label>
                  <Select
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                    options={SCOPE_OPTIONS}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">類型</label>
                  <Select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    options={TYPE_OPTIONS}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium">說明（選填）</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="標籤用途說明"
              />
            </div>

            {/* Preview */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">預覽：</span>
              <Badge color={formColor}>{formName || '標籤名稱'}</Badge>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
