'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { SettingsHeader, SegmentedTabs } from './SettingsHeader';
import { AddIcon, DeleteIcon, EditIcon } from '@/components/icons/figma-icons';
import {
  PageDialog,
  PageDialogContent,
  PageDialogHeader,
  PageDialogTitle,
  PageDialogFooter,
} from '@/components/ui/page-dialog';
import { getApiErrorMessage } from '@/lib/api-error';

interface Tag {
  id: string;
  name: string;
  color: string;
  type: string;
  scope: string;
  description?: string;
}

const SCOPE_OPTIONS = [
  { value: 'CONTACT', label: '聯絡人' },
  { value: 'CONVERSATION', label: '對話' },
  { value: 'CASE', label: '案件' },
  { value: 'MATERIAL', label: '素材' },
];

const SCOPE_LABELS: Record<string, string> = {
  CONTACT: '聯絡人',
  CONVERSATION: '對話',
  CASE: '案件',
  MATERIAL: '素材',
};

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6b7280',
];

// 欄寬依 Claude Design：標籤名稱、類型、描述、操作
const TAG_COLS = 'grid grid-cols-[minmax(160px,1fr)_120px_minmax(0,2fr)_96px] items-center gap-4 px-5';

export function TagManagement() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [filterScope, setFilterScope] = useState<string>('ALL');

  // Form
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#6366f1');
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
    setFormScope('CONTACT');
    setFormDescription('');
    setError('');
    setShowDialog(true);
  };

  const openEdit = (tag: Tag) => {
    setEditingTag(tag);
    setFormName(tag.name);
    setFormColor(tag.color);
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
          type: 'MANUAL',
          scope: formScope,
          description: formDescription.trim() || undefined,
        });
      }
      setShowDialog(false);
      fetchTags();
    } catch (err) {
      setError(getApiErrorMessage(err, '儲存失敗'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此標籤嗎？已套用在聯絡人、對話和案件上的標籤也會一併移除。')) return;
    try {
      await api.delete(`/tags/${id}`);
      fetchTags();
    } catch {
      console.error('Failed to delete tag');
      alert('刪除標籤失敗，請稍後重試');
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
    // 版面依 Claude Design「標籤管理」：標題區＋新增、範圍篩選（附數量）、標籤列表、總數；依 Figma 微調
    <div className="flex flex-col gap-5">
      <SettingsHeader title="標籤管理" description="管理聯繫人、對話和案件的分類標籤">
        <Button size="lg" className="w-[140px]" onClick={openCreate}>
          <AddIcon />
          新增標籤
        </Button>
      </SettingsHeader>

      <SegmentedTabs
        label="標籤範圍"
        value={filterScope}
        onChange={setFilterScope}
        items={(['ALL', 'CONTACT', 'CONVERSATION', 'CASE', 'MATERIAL'] as const).map((scope) => ({
          value: scope,
          label: scope === 'ALL' ? '全部' : SCOPE_LABELS[scope],
          count: scope === 'ALL' ? tags.length : tags.filter((t) => t.scope === scope).length,
        }))}
      />

      <div role="table" aria-label="標籤列表" className="overflow-hidden rounded-lg border border-border">
        <div role="row" className={`${TAG_COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
          <span role="columnheader">標籤名稱</span>
          <span role="columnheader">類型</span>
          <span role="columnheader">描述</span>
          <span role="columnheader" className="text-right">操作</span>
        </div>
        {filtered.map((tag) => (
          <div key={tag.id} role="row" className={`${TAG_COLS} border-b border-border bg-background py-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-hover`}>
            <span role="cell" className="min-w-0">
              <span
                className="inline-flex h-6 max-w-full items-center truncate rounded-full px-3 text-xs font-medium text-white"
                style={{ backgroundColor: tag.color || 'hsl(var(--primary))' }}
              >
                {tag.name}
              </span>
            </span>
            <span role="cell" className="text-muted-foreground">{SCOPE_LABELS[tag.scope]}</span>
            <span role="cell" className="truncate text-muted-foreground" title={tag.description}>{tag.description || '—'}</span>
            <span role="cell" className="flex items-center justify-end gap-1">
              <Button size="icon-sm" variant="ghost" onClick={() => openEdit(tag)} aria-label={`編輯「${tag.name}」`} title="編輯">
                <EditIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => handleDelete(tag.id)}
                className="text-destructive"
                aria-label={`刪除「${tag.name}」`}
                title="刪除"
              >
                <DeleteIcon />
              </Button>
            </span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">此範圍目前沒有標籤</div>
        )}
      </div>
      {filtered.length > 0 && <p className="text-sm text-muted-foreground">共 {filtered.length} 個標籤</p>}

      {/* Create/Edit Dialog */}
      <PageDialog section="設定" parent="標籤管理" open={showDialog} onOpenChange={setShowDialog}>
        <PageDialogContent>
          <PageDialogHeader>
            <PageDialogTitle>
              {editingTag ? '編輯標籤' : '新增標籤'}
            </PageDialogTitle>
          </PageDialogHeader>
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
              <div>
                <label className="mb-1.5 block text-sm font-medium">適用範圍</label>
                <Select
                  value={formScope}
                  onChange={(e) => setFormScope(e.target.value)}
                  options={SCOPE_OPTIONS}
                />
              </div>
            )}

            {editingTag && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">適用範圍</label>
                <div>
                  <span className="text-sm text-muted-foreground">
                    {SCOPE_LABELS[formScope]}
                  </span>
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
          <PageDialogFooter>
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
          </PageDialogFooter>
        </PageDialogContent>
      </PageDialog>
    </div>
  );
}
