'use client';

/**
 * MaterialCategoryManager — 素材分類管理 dialog
 *
 * 功能：新增分類、改名、搬移（改父分類，後端擋自我循環）、刪除（其下素材歸「未分類」不刪）。
 * 對齊 improve-material-library-governance wireframe「分類管理」畫面。
 */

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import {
  createMaterialCategory,
  updateMaterialCategory,
  deleteMaterialCategory,
  type MaterialCategoryNode,
} from '@/hooks/useMaterials';

interface Props {
  categories: MaterialCategoryNode[];
  onClose: () => void;
  onChange: () => void;
}

export function MaterialCategoryManager({ categories, onClose, onChange }: Props) {
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roots = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        '操作失敗，請重試';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await run(async () => {
      await createMaterialCategory({ name: newName.trim(), parentId: newParent || null });
      setNewName('');
      setNewParent('');
    });
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    await run(async () => {
      await updateMaterialCategory(id, { name: editName.trim() });
      setEditingId(null);
    });
  };

  const handleDelete = async (cat: MaterialCategoryNode) => {
    const childCount = childrenOf(cat.id).length;
    const msg = childCount > 0
      ? `刪除「${cat.name}」及其 ${childCount} 個子分類？其下素材會歸為未分類（不會被刪除）。`
      : `刪除分類「${cat.name}」？其下素材會歸為未分類（不會被刪除）。`;
    if (!confirm(msg)) return;
    await run(() => deleteMaterialCategory(cat.id));
  };

  const CategoryRow = ({ cat, depth }: { cat: MaterialCategoryNode; depth: number }) => (
    <>
      <div
        className="mb-1.5 flex items-center justify-between rounded-md border border-border bg-white px-3 py-2 dark:bg-card"
        style={{ marginLeft: `${depth * 24}px` }}
      >
        {editingId === cat.id ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename(cat.id)}
              className="h-7 text-sm"
              autoFocus
            />
            <Button size="sm" variant="ghost" onClick={() => handleRename(cat.id)} disabled={busy}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span>{cat.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{cat.materialCount}</span>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive-subtle"
                onClick={() => handleDelete(cat)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
      </div>
      {childrenOf(cat.id).map((child) => (
        <CategoryRow key={child.id} cat={child} depth={depth + 1} />
      ))}
    </>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>管理分類</DialogTitle>
        </DialogHeader>

        {/* 新增列 */}
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="新增分類名稱…"
            className="flex-1"
          />
          <select
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            className="rounded-md border border-border bg-white px-2 py-2 text-sm text-foreground dark:bg-card"
            aria-label="上層分類"
          >
            <option value="">頂層</option>
            {roots.map((c) => (
              <option key={c.id} value={c.id}>{c.name} 底下</option>
            ))}
          </select>
          <Button onClick={handleCreate} disabled={busy || !newName.trim()}>
            <Plus className="mr-1 h-4 w-4" />新增
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* 清單 */}
        <div className="max-h-[50vh] overflow-y-auto pt-1">
          {roots.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">尚無分類，於上方新增第一個。</p>
          )}
          {roots.map((c) => <CategoryRow key={c.id} cat={c} depth={0} />)}
        </div>

        <p className="text-xs text-muted-foreground">
          刪除分類時，其下素材會歸為「未分類」而非被刪除。子分類不可移入自己的子孫（系統會擋下）。
        </p>
      </DialogContent>
    </Dialog>
  );
}
