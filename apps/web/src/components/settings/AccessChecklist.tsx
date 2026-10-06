'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';

export interface AccessChecklistItem {
  id: string;
  label: string;
  hint?: string;
}

interface AccessChecklistProps {
  /** 取得選項的 API 路徑（回傳 { data: [...] }） */
  endpoint: string;
  /** API 回傳的一列轉成選項；回傳 null 表示略過 */
  toItem: (row: Record<string, unknown>) => AccessChecklistItem | null;
  label: string;
  description: string;
  emptyText: string;
  /**
   * 目前勾選的 ID。null 代表「全選」（預設）：呼叫端此時不要送出這個欄位，由後端套用相同的預設
   * （新渠道給所有啟用中的成員、新成員給建立者能指派的渠道）。全選時不送出，也避免清單很長時
   * 超過 API 的陣列上限。清單載入失敗時維持 null。
   * 選擇保存在呼叫端：這個元件重新掛載（例如精靈切換步驟）時不會重設。
   */
  value: string[] | null;
  onChange: (ids: string[] | null) => void;
}

/**
 * 建立渠道或成員時指定可見範圍的勾選清單（change channel-visibility-fail-closed）。
 * 渠道可見範圍是 fail-closed：沒有勾到的成員（總店除外）看不到這個渠道。
 * 載入後預設全選，管理員取消不需要的項目即可。
 */
export function AccessChecklist({ endpoint, toItem, label, description, emptyText, value, onChange }: AccessChecklistProps) {
  const [items, setItems] = useState<AccessChecklistItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setLoadError(false);
    api
      .get(endpoint)
      .then((res) => {
        if (cancelled) return;
        const rows = ((res.data?.data ?? []) as Array<Record<string, unknown>>)
          .map(toItem)
          .filter((x): x is AccessChecklistItem => x !== null);
        setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // toItem 由呼叫端每次 render 重新建立；只在 endpoint 變動時重新載入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const allIds = items?.map((i) => i.id) ?? [];
  const isChecked = (id: string) => value === null || value.includes(id);
  /** 勾選結果等於全部時回報 null（全選＝不送出，由後端套用預設） */
  const report = (ids: string[]) => onChange(allIds.length > 0 && allIds.every((x) => ids.includes(x)) ? null : ids);
  const toggle = (id: string) => {
    const base = value ?? allIds;
    report(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };
  const allSelected = value === null || (allIds.length > 0 && allIds.every((x) => value.includes(x)));
  const noneSelected = value !== null && !allIds.some((x) => value.includes(x));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        {items !== null && items.length > 0 && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange(allSelected ? [] : null)}
          >
            {allSelected ? '全部取消' : '全選'}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {loadError ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          無法載入清單，將使用預設的可見範圍。建立後可在設定中調整。
        </p>
      ) : items === null ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">載入中…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {items.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={isChecked(item.id)} onChange={() => toggle(item.id)} />
              <span className="truncate">{item.label}</span>
              {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
            </label>
          ))}
        </div>
      )}
      {items !== null && items.length > 0 && noneSelected && (
        <p className="text-xs text-destructive">沒有勾選任何項目，只有總店（可檢視所有渠道的角色）看得到。</p>
      )}
    </div>
  );
}

/** GET /agents 的一列轉成成員選項 */
export function agentToItem(row: Record<string, unknown>): AccessChecklistItem | null {
  if (typeof row.id !== 'string') return null;
  const name = typeof row.name === 'string' && row.name ? row.name : String(row.email ?? row.id);
  return { id: row.id, label: name, hint: typeof row.email === 'string' ? row.email : undefined };
}

/** GET /channels 的一列轉成渠道選項 */
export function channelToItem(row: Record<string, unknown>): AccessChecklistItem | null {
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    label: String(row.displayName ?? row.id),
    hint: typeof row.channelType === 'string' ? row.channelType : undefined,
  };
}
