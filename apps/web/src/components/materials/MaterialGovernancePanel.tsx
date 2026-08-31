'use client';

/**
 * MaterialGovernancePanel — 素材編輯頁的治理側欄
 *
 * 分類（單選，含巢狀縮排）、標籤（多值增刪）、狀態（draft / approved 手動切）。
 * 對齊 improve-material-library-governance。狀態機（送審流程）另開 change，此處僅手動設定。
 */

import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useMaterialCategoryTree, type MaterialCategoryNode } from '@/hooks/useMaterials';

interface GovernanceState {
  categoryId: string | null;
  tags: string[];
  status: string;
}

interface Props {
  value: GovernanceState;
  onChange: (next: GovernanceState) => void;
}

/** 把分類樹攤平成含深度的清單，供 select 縮排顯示。 */
function flattenTree(cats: MaterialCategoryNode[]): { cat: MaterialCategoryNode; depth: number }[] {
  const out: { cat: MaterialCategoryNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of cats.filter((x) => x.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function MaterialGovernancePanel({ value, onChange }: Props) {
  const { categories } = useMaterialCategoryTree();
  const [tagInput, setTagInput] = useState('');

  const flat = flattenTree(categories);

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || value.tags.includes(t)) { setTagInput(''); return; }
    onChange({ ...value, tags: [...value.tags, t] });
    setTagInput('');
  };
  const removeTag = (t: string) => onChange({ ...value, tags: value.tags.filter((x) => x !== t) });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-white p-4 dark:bg-card">
      <div className="text-sm font-semibold text-foreground">分類與標籤</div>

      {/* 分類 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">分類</label>
        <select
          value={value.categoryId ?? ''}
          onChange={(e) => onChange({ ...value, categoryId: e.target.value || null })}
          className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-sm text-foreground dark:bg-card"
        >
          <option value="">未分類</option>
          {flat.map(({ cat, depth }) => (
            <option key={cat.id} value={cat.id}>
              {'　'.repeat(depth)}{cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* 標籤 */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">標籤</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-primary">
              {t}
              <button type="button" onClick={() => removeTag(t)} className="opacity-70 hover:opacity-100" aria-label="移除標籤">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {value.tags.length === 0 && <span className="text-xs text-muted-foreground/70">尚無標籤</span>}
        </div>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="輸入標籤後按 Enter"
            className="h-8 text-sm"
          />
          <button
            type="button"
            onClick={addTag}
            className="flex items-center rounded-md border border-border px-2 text-muted-foreground hover:bg-muted"
            aria-label="新增標籤"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
