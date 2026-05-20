'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Copy, Trash2, MoreHorizontal, Edit } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { MarketingTabs } from '@/components/marketing/MarketingTabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMaterials, duplicateMaterial, deleteMaterial, type Material } from '@/hooks/useMaterials';

const CHANNEL_FILTERS = [
  { value: '', label: '全部' },
  { value: 'line', label: 'LINE' },
  { value: 'fb', label: 'FB' },
];

export default function MaterialsListPage() {
  const router = useRouter();
  const [channelType, setChannelType] = useState('');
  const [q, setQ] = useState('');
  const { materials, meta, isLoading, mutate } = useMaterials({
    channelType: channelType || undefined,
    q: q || undefined,
  });

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
    <div className="flex h-screen flex-col bg-slate-50">
      <Topbar title="行銷" />
      <MarketingTabs active="materials" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">訊息素材</h1>
              <p className="mt-1 text-sm text-slate-500">已客製化的可發送內容。支援 per-recipient 變數替換。</p>
            </div>
            <Button onClick={() => router.push('/dashboard/marketing/materials/new')}>
              <Plus className="mr-1 h-4 w-4" />從版型建立
            </Button>
          </header>

          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {CHANNEL_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setChannelType(f.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    channelType === f.value
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋素材名稱" className="pl-9" />
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {isLoading && <div className="py-12 text-center text-sm text-slate-500">載入中…</div>}
            {!isLoading && materials.length === 0 && (
              <div className="py-16 text-center">
                <div className="text-sm text-slate-500">尚未建立任何素材</div>
                <Button className="mt-3" onClick={() => router.push('/dashboard/marketing/materials/new')}>
                  <Plus className="mr-1 h-4 w-4" />從版型建立第一個素材
                </Button>
              </div>
            )}
            {!isLoading && materials.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left font-semibold">素材</th>
                    <th className="px-4 py-3 text-left font-semibold">來源版型</th>
                    <th className="px-4 py-3 text-left font-semibold">Channel</th>
                    <th className="px-4 py-3 text-left font-semibold">變數</th>
                    <th className="px-4 py-3 text-right font-semibold">使用</th>
                    <th className="px-4 py-3 text-left font-semibold">更新</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m) => (
                    <MaterialRow key={m.id} material={m} onDuplicate={handleDuplicate} onDelete={handleDelete} onEdit={(id) => router.push(`/dashboard/marketing/materials/${id}`)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {meta && (
            <div className="text-xs text-slate-400">共 {meta.total} 個素材</div>
          )}
        </div>
      </main>
    </div>
  );
}

function MaterialRow({ material, onDuplicate, onDelete, onEdit }: {
  material: Material;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const channelLabel = material.channelType.toUpperCase();
  const channelColor = material.channelType === 'line' ? '#06c755' : material.channelType === 'fb' ? '#1877f2' : '#059669';

  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="font-semibold text-slate-900">{material.name}</div>
        {material.description && <div className="mt-0.5 text-xs text-slate-500">{material.description}</div>}
      </td>
      <td className="px-4 py-3 text-xs text-slate-600">
        {material.template?.name ?? '—'}
        <div className="text-[10px] text-slate-400 font-mono">{material.contentType}</div>
      </td>
      <td className="px-4 py-3">
        <Badge color={channelColor}>{channelLabel}</Badge>
      </td>
      <td className="px-4 py-3 text-xs">
        {material.variables.length === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className="text-slate-700">{material.variables.length} 個</span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-xs">{material.usageCount}</td>
      <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">{new Date(material.updatedAt).toISOString().slice(0, 10)}</td>
      <td className="relative px-4 py-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(material.id)}>
          <Edit className="mr-1 h-3 w-3" />編輯
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMenuOpen((v) => !v)}>
          <MoreHorizontal className="h-3 w-3" />
        </Button>
        {menuOpen && (
          <div className="absolute right-4 top-full z-10 mt-1 w-32 rounded-md border border-slate-200 bg-white py-1 shadow-md">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50"
              onClick={() => { setMenuOpen(false); onDuplicate(material.id); }}
            >
              <Copy className="h-3 w-3" />複製
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
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
