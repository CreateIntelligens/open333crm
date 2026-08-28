'use client';

/**
 * MaterialVersionHistory — 素材版本歷史面板
 *
 * 時間軸式列出版本（新到舊），可還原到指定版（後端會寫回內容並產生新版，
 * 線性歷史不破壞）。對齊 improve-material-library-governance wireframe「版本歷史」畫面。
 */

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMaterialVersions, restoreMaterialVersion } from '@/hooks/useMaterials';

interface Props {
  materialId: string;
  /** 還原後通知父層重載素材內容 */
  onRestored: () => void;
}

export function MaterialVersionHistory({ materialId, onRestored }: Props) {
  const { versions, isLoading, mutate } = useMaterialVersions(materialId);
  const [busyNo, setBusyNo] = useState<number | null>(null);

  const handleRestore = async (versionNo: number) => {
    if (!confirm(`還原到 v${versionNo}？目前內容會被覆蓋，並會保留為新的一版（不會遺失歷史）。`)) return;
    setBusyNo(versionNo);
    try {
      await restoreMaterialVersion(materialId, versionNo);
      await mutate();
      onRestored();
    } finally {
      setBusyNo(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-white p-4 dark:bg-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" />版本歷史
      </div>

      {isLoading && <p className="py-4 text-center text-xs text-muted-foreground">載入中…</p>}
      {!isLoading && versions.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">尚無版本紀錄</p>
      )}

      <ol className="relative space-y-3 border-l border-border pl-4">
        {versions.map((v, idx) => {
          const isCurrent = idx === 0;
          return (
            <li key={v.id} className="relative">
              <span
                className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${
                  isCurrent ? 'border-primary bg-white dark:bg-card' : 'border-border bg-white dark:bg-card'
                }`}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-foreground">v{v.versionNo}</span>
                    {isCurrent && (
                      <span className="rounded bg-green-50 px-1.5 py-px text-[10px] font-semibold text-green-700 dark:bg-green-950 dark:text-green-400">
                        目前
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {v.name} · {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true, locale: zhTW })}
                  </p>
                </div>
                {!isCurrent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyNo !== null}
                    onClick={() => handleRestore(v.versionNo)}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    {busyNo === v.versionNo ? '還原中…' : '還原'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
