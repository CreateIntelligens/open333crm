'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Plus, Search, Copy, Trash2, MoreHorizontal, Edit, X, FolderCog } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { MarketingTabs } from '@/components/marketing/MarketingTabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useMaterials,
  useMaterialCategoryTree,
  useMaterialTags,
  duplicateMaterial,
  deleteMaterial,
  type Material,
  type MaterialSort,
  type MaterialCategoryNode,
} from '@/hooks/useMaterials';
import { MaterialCategoryManager } from '@/components/materials/MaterialCategoryManager';

const CHANNEL_FILTERS = [
  { value: '', label: '全部' },
  { value: 'line', label: 'LINE' },
  { value: 'fb', label: 'FB' },
];

const SORT_OPTIONS: { value: MaterialSort; label: string }[] = [
  { value: 'recent_used', label: '最近使用' },
  { value: 'most_used', label: '使用次數' },
  { value: 'updated', label: '更新時間' },
  { value: 'name', label: '名稱' },
];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  approved: { label: '已核准', cls: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400' },
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
};

export default function MaterialsListPage() {
  const router = useRouter();
  const [channelType, setChannelType] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sort, setSort] = useState<MaterialSort>('updated');
  const [q, setQ] = useState('');
  const [catManagerOpen, setCatManagerOpen] = useState(false);

  const { categories, mutate: mutateCats } = useMaterialCategoryTree();
  const { tags } = useMaterialTags();
  const { materials, meta, isLoading, mutate } = useMaterials({
    channelType: channelType || undefined,
    categoryId: categoryId || undefined,
    tags: activeTags.length > 0 ? activeTags : undefined,
    sort,
    q: q || undefined,
  });

  const maxUsage = meta?.maxUsageCount ?? 0;
  const catName = useMemo(
    () => categories.find((c) => c.id === categoryId)?.name,
    [categories, categoryId],
  );

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const clearFilters = () => {
    setCategoryId('');
    setActiveTags([]);
  };
  const hasFilters = categoryId !== '' || activeTags.length > 0;

  const handleDuplicate = async (id: string) => {
    await duplicateMaterial(id);
    mutate();
  };
  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這個素材嗎？（軟刪，可在後台復原）')) return;
    await deleteMaterial(id);
    mutate();
  };

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="行銷" />
      <MarketingTabs active="materials" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">訊息素材</h1>
              <p className="mt-1 text-sm text-muted-foreground">已客製化的可發送內容。支援 per-recipient 變數替換。</p>
            </div>
            <Button onClick={() => router.push('/dashboard/marketing/materials/new')}>
              <Plus className="mr-1 h-4 w-4" />從版型建立
            </Button>
          </header>

          <div className="flex gap-5">
            {/* ── 左側：分類樹 + 標籤 ── */}
            <aside className="w-52 shrink-0 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">分類</span>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    onClick={() => setCatManagerOpen(true)}
                  >
                    <FolderCog className="h-3 w-3" />管理
                  </button>
                </div>
                <CategoryTree
                  categories={categories}
                  selectedId={categoryId}
                  onSelect={setCategoryId}
                  totalCount={meta?.total ?? 0}
                />
              </div>

              {tags.length > 0 && (
                <div>
                  <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">標籤</div>
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                          activeTags.includes(t)
                            ? 'border-transparent bg-primary/10 font-medium text-primary'
                            : 'border-border bg-white text-muted-foreground hover:border-input dark:bg-card'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            {/* ── 右側：工具列 + 表格 ── */}
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋素材名稱" className="pl-9" />
                </div>
                <div className="flex gap-2">
                  {CHANNEL_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setChannelType(f.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        channelType === f.value
                          ? 'border-foreground bg-foreground text-white'
                          : 'border-border bg-white text-muted-foreground hover:border-input dark:bg-card'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as MaterialSort)}
                  className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-foreground dark:bg-card"
                  aria-label="排序方式"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>排序：{o.label}</option>
                  ))}
                </select>
              </div>

              {hasFilters && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>篩選中：</span>
                  {catName && (
                    <FilterPill label={`分類：${catName}`} onRemove={() => setCategoryId('')} />
                  )}
                  {activeTags.map((t) => (
                    <FilterPill key={t} label={`標籤：${t}`} onRemove={() => toggleTag(t)} />
                  ))}
                  <button type="button" onClick={clearFilters} className="underline hover:text-foreground">
                    清除全部
                  </button>
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-border bg-white dark:bg-card">
                {isLoading && <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>}
                {!isLoading && materials.length === 0 && (
                  <div className="py-16 text-center">
                    <div className="text-sm text-muted-foreground">
                      {hasFilters ? '此篩選條件下沒有素材' : '尚未建立任何素材'}
                    </div>
                    {!hasFilters && (
                      <Button className="mt-3" onClick={() => router.push('/dashboard/marketing/materials/new')}>
                        <Plus className="mr-1 h-4 w-4" />從版型建立第一個素材
                      </Button>
                    )}
                  </div>
                )}
                {!isLoading && materials.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3 text-left font-semibold">名稱</th>
                          <th className="px-4 py-3 text-left font-semibold">狀態</th>
                          <th className="px-4 py-3 text-left font-semibold">版本</th>
                          <th className="px-4 py-3 text-left font-semibold">使用率</th>
                          <th className="px-4 py-3 text-left font-semibold">最後使用</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {materials.map((m) => (
                          <MaterialRow
                            key={m.id}
                            material={m}
                            maxUsage={maxUsage}
                            onDuplicate={handleDuplicate}
                            onDelete={handleDelete}
                            onEdit={(id) => router.push(`/dashboard/marketing/materials/${id}`)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {meta && <div className="text-xs text-muted-foreground">共 {meta.total} 個素材</div>}
            </div>
          </div>
        </div>
      </main>

      {catManagerOpen && (
        <MaterialCategoryManager
          categories={categories}
          onClose={() => setCatManagerOpen(false)}
          onChange={() => { mutateCats(); mutate(); }}
        />
      )}
    </div>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1.5 font-medium text-primary">
      {label}
      <button type="button" onClick={onRemove} className="opacity-70 hover:opacity-100" aria-label="移除篩選">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function CategoryTree({
  categories, selectedId, onSelect, totalCount,
}: {
  categories: MaterialCategoryNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  totalCount: number;
}) {
  const roots = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  const Row = ({ cat, depth }: { cat: MaterialCategoryNode; depth: number }) => (
    <>
      <button
        type="button"
        onClick={() => onSelect(cat.id)}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={`flex w-full items-center justify-between rounded-md py-1.5 pr-2 text-sm transition-colors ${
          selectedId === cat.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        <span className="truncate">{cat.name}</span>
        <span className="ml-2 shrink-0 text-xs tabular-nums opacity-70">{cat.materialCount}</span>
      </button>
      {childrenOf(cat.id).map((child) => (
        <Row key={child.id} cat={child} depth={depth + 1} />
      ))}
    </>
  );

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => onSelect('')}
        className={`flex w-full items-center justify-between rounded-md py-1.5 pl-2 pr-2 text-sm transition-colors ${
          selectedId === '' ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        <span>全部素材</span>
        <span className="ml-2 text-xs tabular-nums opacity-70">{totalCount}</span>
      </button>
      {roots.map((c) => <Row key={c.id} cat={c} depth={0} />)}
      {categories.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground/70">尚無分類，點「管理」新增</p>
      )}
    </div>
  );
}

function MaterialRow({ material, maxUsage, onDuplicate, onDelete, onEdit }: {
  material: Material;
  maxUsage: number;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const channelLabel = material.channelType.toUpperCase();
  const channelColor = material.channelType === 'line' ? '#06c755' : material.channelType === 'fb' ? '#1877f2' : '#059669';
  const statusInfo = STATUS_LABEL[material.status] ?? STATUS_LABEL.draft;
  const usagePct = maxUsage > 0 ? Math.max(2, Math.round((material.usageCount / maxUsage) * 100)) : 0;
  const lastUsed = material.lastUsedAt
    ? formatDistanceToNow(new Date(material.lastUsedAt), { addSuffix: true, locale: zhTW })
    : '—';

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge color={channelColor}>{channelLabel}</Badge>
          <span className="font-semibold text-foreground">{material.name}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{material.contentType}</span>
          {material.tags.map((t) => (
            <span key={t} className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{t}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusInfo.cls}`}>
          {statusInfo.label}
        </span>
      </td>
      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
        <button type="button" className="underline decoration-dotted hover:text-foreground" onClick={() => onEdit(material.id)}>
          歷史
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-foreground">{material.usageCount.toLocaleString()}</span>
          <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${usagePct}%` }} />
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{lastUsed}</td>
      <td className="relative px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(material.id)}>
          <Edit className="mr-1 h-3 w-3" />編輯
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMenuOpen((v) => !v)}>
          <MoreHorizontal className="h-3 w-3" />
        </Button>
        {menuOpen && (
          <div className="absolute right-4 top-full z-10 mt-1 w-32 rounded-md border border-border bg-white py-1 shadow-md dark:bg-card">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() => { setMenuOpen(false); onDuplicate(material.id); }}
            >
              <Copy className="h-3 w-3" />複製
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive-subtle"
              onClick={() => { setMenuOpen(false); onDelete(material.id); }}
            >
              <Trash2 className="h-3 w-3" />刪除
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
