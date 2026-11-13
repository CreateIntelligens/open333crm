'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Search, Copy, Trash2, MoreHorizontal, X, FolderCog } from 'lucide-react';
import { AddIcon, EditIcon } from '@/components/icons/figma-icons';
import { Select } from '@/components/ui/select';
import { Topbar } from '@/components/layout/Topbar';
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
import { cn } from '@/lib/utils';
import { channelDisplayName } from '@open333crm/shared';

const CHANNEL_FILTERS = [
  { value: '', label: '全部' },
  { value: 'line', label: 'LINE' },
  { value: 'fb', label: channelDisplayName('fb') },
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
    // 版面依 Claude Design「訊息素材庫列表頁」：標題列＋說明，右側主要按鈕；左側分類樹維持（分類為多層樹狀，改成橫向頁籤會選不到子分類）
    <div className="flex h-full flex-col">
      <Topbar title="訊息素材庫" description="管理可重複使用的訊息素材，從版型建立內容後即可套用於推播、自動化與客服快速回覆">
        <Button size="lg" onClick={() => router.push('/dashboard/marketing/materials/new')}>
          <AddIcon />
          從版型建立新素材
        </Button>
      </Topbar>
      <main className="flex-1 overflow-y-auto px-7 pb-7">
        <div className="space-y-5">

          <div className="flex gap-5">
            {/* ── 左側：分類樹 + 標籤 ── */}
            <aside className={cn('shrink-0 space-y-5', categories.length > 0 ? 'w-52' : 'w-auto')}>
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
                {categories.length > 0 ? (
                  <CategoryTree
                    categories={categories}
                    selectedId={categoryId}
                    onSelect={setCategoryId}
                    totalCount={meta?.total ?? 0}
                  />
                ) : (
                  <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                    <span>尚無分類</span>
                    <button type="button" className="text-primary hover:underline" onClick={() => setCatManagerOpen(true)}>
                      新增
                    </button>
                  </div>
                )}
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
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="依素材名稱搜尋" className="pl-9" />
                </div>
                <div role="group" aria-label="依頻道篩選" className="flex h-10 items-center gap-1 rounded-md border border-border bg-muted p-1">
                  {CHANNEL_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      aria-pressed={channelType === f.value}
                      onClick={() => setChannelType(f.value)}
                      className={cn(
                        'flex h-8 items-center rounded-md px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        channelType === f.value ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <Select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as MaterialSort)}
                  aria-label="排序方式"
                  className="w-[180px]"
                  options={SORT_OPTIONS.map((o) => ({ value: o.value, label: `排序：${o.label}` }))}
                />
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

              <div className="overflow-hidden rounded-lg border border-border bg-background">
                {isLoading && <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>}
                {!isLoading && materials.length === 0 && (
                  <div className="py-16 text-center">
                    <div className="text-sm text-muted-foreground">
                      {hasFilters ? '此篩選條件下沒有素材' : '尚未建立任何素材'}
                    </div>
                    {!hasFilters && (
                      <Button className="mt-3" onClick={() => router.push('/dashboard/marketing/materials/new')}>
                        <AddIcon />從版型建立第一個素材
                      </Button>
                    )}
                  </div>
                )}
                {!isLoading && materials.length > 0 && (
                  <div className="overflow-x-auto">
                    <table data-plain className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted text-sm text-muted-foreground">
                          <th scope="col" className="px-5 py-2.5 text-left font-medium">素材名稱 / 分類</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">頻道</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">狀態</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">版本歷史</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">使用率</th>
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">最後使用</th>
                          <th scope="col" className="px-5 py-2.5 text-right font-medium">操作</th>
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

              {meta && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>共 {meta.total} 筆素材</span>
                  <span>本頁 已核准 {materials.filter((m) => m.status === 'approved').length} · 草稿 {materials.filter((m) => m.status === 'draft').length}</span>
                </div>
              )}
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
  const channelLabel = channelDisplayName(material.channelType);
  const channelColor = material.channelType === 'line' ? '#06c755' : material.channelType === 'fb' ? '#1877f2' : '#059669';
  const statusInfo = STATUS_LABEL[material.status] ?? STATUS_LABEL.draft;
  const usagePct = maxUsage > 0 ? Math.max(2, Math.round((material.usageCount / maxUsage) * 100)) : 0;
  const lastUsed = material.lastUsedAt
    ? formatDistanceToNow(new Date(material.lastUsedAt), { addSuffix: true, locale: zhTW })
    : '—';

  const lastUsedAt = material.lastUsedAt ? new Date(material.lastUsedAt) : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const category = material.materialCategory?.name ?? material.category;

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-hover">
      <td className="px-5 py-3.5">
        <div className="font-semibold text-foreground">{material.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{material.contentType}</span>
          {category && (<><span aria-hidden="true">·</span><span>{category}</span></>)}
          {material.tags.map((t) => (
            <span key={t} className="rounded bg-muted px-1.5 py-px text-xs text-muted-foreground">{t}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3.5"><Badge color={channelColor}>{channelLabel}</Badge></td>
      <td className="px-4 py-3.5">
        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${statusInfo.cls}`}>
          {statusInfo.label}
        </span>
      </td>
      <td className="px-4 py-3.5 text-sm">
        <button type="button" className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onEdit(material.id)}>
          歷史紀錄
        </button>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-1">
          <span className="text-foreground"><span className="tabular-nums font-medium">{material.usageCount.toLocaleString()}</span> <span className="text-xs text-muted-foreground">次</span></span>
          <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${usagePct}%` }} />
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5 text-sm tabular-nums" title={lastUsed}>
        {lastUsedAt ? (
          <span className="flex flex-col leading-5">
            <span className="text-foreground">{`${lastUsedAt.getFullYear()}/${pad(lastUsedAt.getMonth() + 1)}/${pad(lastUsedAt.getDate())}`}</span>
            <span className="text-xs text-muted-foreground">{`${pad(lastUsedAt.getHours())}:${pad(lastUsedAt.getMinutes())}`}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">尚未使用</span>
        )}
      </td>
      <td className="relative px-5 py-3.5">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="xs" onClick={() => onEdit(material.id)} aria-label={`編輯「${material.name}」`}>
            <EditIcon />編輯
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`「${material.name}」更多操作`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal />
          </Button>
        </div>
        {menuOpen && (
          <div role="menu" className="absolute right-5 top-full z-10 mt-1 w-36 rounded-md border border-border bg-background py-1 shadow-dropdown">
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
              onClick={() => { setMenuOpen(false); onDuplicate(material.id); }}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />複製
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive-subtle"
              onClick={() => { setMenuOpen(false); onDelete(material.id); }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />刪除
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
