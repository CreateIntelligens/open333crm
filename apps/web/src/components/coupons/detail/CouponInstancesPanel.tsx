'use client';

/**
 * 序號明細分頁（UX 規則第 4、5 節；Jira CM-196「詳情頁返回、序號明細」）。
 * - 依序號模式調整：一人一碼顯示序號欄；共用碼改顯示共用券號卡片、不顯示序號欄；序號包只列已發放的序號。
 * - 篩選改變一律回第 1 頁；文字搜尋 debounce。
 * - 「尚未發放任何序號」與「沒有符合條件的序號」分開（差異 D3）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  downloadInstancesCsv,
  useCouponInstances,
  type Coupon,
  type CouponInstanceRow,
  type InstanceStatus,
} from '@/hooks/useCoupons';
import { InstanceStatusBadge } from '@/components/coupons/CouponBadges';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatNumber } from '@/lib/coupon/labels';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  EMPTY_FILTERS,
  INSTANCE_PAGE_SIZE,
  LARGE_EXPORT_THRESHOLD,
  copyText,
  hasAnyFilter,
  issuedSourceLines,
  saveBlob,
  toInstanceQuery,
  type InstanceFilters,
} from './detail-helpers';
import { InstanceHistoryDrawer } from './InstanceHistoryDrawer';

interface Props {
  coupon: Coupon;
  /** 已發出的序號數（成效統計的 issued）；序號包說明與匯出提示使用，取不到時為 null */
  issuedCount: number | null;
  /** 序號包匯入的序號總數；非序號包模式或尚未載入為 null */
  poolSize?: number | null;
  showOk: (message: string) => void;
  showError: (message: string) => void;
}

const STATUS_OPTIONS: Array<{ value: InstanceStatus | ''; label: string }> = [
  { value: '', label: '全部狀態' },
  { value: 'ISSUED', label: '未領取' },
  { value: 'CLAIMED', label: '已領取' },
  { value: 'REDEEMED', label: '已使用' },
  { value: 'EXPIRED', label: '已過期' },
  { value: 'REVOKED', label: '已作廢' },
];

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function CouponInstancesPanel({ coupon, issuedCount, poolSize = null, showOk, showError }: Props) {
  const shared = coupon.codeMode === 'SHARED_CODE';
  const imported = coupon.codeMode === 'IMPORTED_CODES';

  const [filters, setFilters] = useState<InstanceFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(filters.q, 300);

  // 搜尋字詞送出後才回到第 1 頁，避免輸入中途頁碼跳動
  const lastQ = useRef(debouncedQ);
  useEffect(() => {
    if (lastQ.current !== debouncedQ) {
      lastQ.current = debouncedQ;
      setPage(1);
    }
  }, [debouncedQ]);

  const applied = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);
  const query = useMemo(() => toInstanceQuery(applied, page), [applied, page]);
  const { instances, meta, error, isLoading, mutate } = useCouponInstances(coupon.id, query);

  const filtered = hasAnyFilter(applied);
  const total = meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / INSTANCE_PAGE_SIZE));

  function updateFilter<K extends keyof InstanceFilters>(key: K, value: InstanceFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    if (key !== 'q') setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  // 記住第一筆序號當作搜尋範例；沒有資料時不顯示「例如 」後面空白（原型的問題）
  const sampleCode = useRef<string | null>(null);
  if (!sampleCode.current && instances[0]?.code) sampleCode.current = instances[0].code;
  const searchLabel = shared ? '顧客名稱' : '序號或顧客名稱';
  const placeholder = shared
    ? '例如 陳小明'
    : sampleCode.current
      ? `例如 ${sampleCode.current}`
      : '輸入序號或顧客名稱';

  // ── 序號歷程側欄 ──
  const [openRow, setOpenRow] = useState<CouponInstanceRow | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openDrawer = useCallback((row: CouponInstanceRow, el: HTMLElement) => {
    triggerRef.current = el;
    setOpenRow(row);
  }, []);
  const closeDrawer = useCallback(() => {
    setOpenRow(null);
    // 關閉後焦點回到原本那一列（UX 規則：Esc 關閉後焦點回到原列）
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  async function copyCode(code: string, okMessage: string) {
    if (await copyText(code)) showOk(okMessage);
    else showError('複製失敗，請手動選取後複製');
  }

  // ── 匯出 CSV ──
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await downloadInstancesCsv(coupon.id);
      saveBlob(blob, `${coupon.displayCode}-序號明細.csv`);
      showOk('已匯出');
    } catch (err) {
      // 回應型別是 blob，後端錯誤訊息通常讀不到，取不到時用規則文案
      setExportError(getApiErrorMessage(err, '匯出失敗，請稍後再試'));
    } finally {
      setExporting(false);
    }
  }
  const largeExport = (issuedCount ?? 0) > LARGE_EXPORT_THRESHOLD;

  const rangeStart = total === 0 ? 0 : (page - 1) * INSTANCE_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * INSTANCE_PAGE_SIZE, total);
  const colCount = shared ? 5 : 6;

  return (
    <section aria-label="序號明細" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="pt-2 text-sm text-muted-foreground">客服可依顧客提供的券號查詢使用狀態</p>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} aria-busy={exporting}>
            <Download />
            {exporting ? '匯出中…' : '匯出 CSV'}
          </Button>
          {largeExport && !exportError && (
            <span className="text-xs text-muted-foreground">筆數較多，可能需要較長時間</span>
          )}
          {exportError && (
            <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
              <span>{exportError === '匯出失敗，請稍後再試' ? exportError : `匯出失敗：${exportError}`}</span>
              <button
                type="button"
                onClick={handleExport}
                className="font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                重試
              </button>
            </div>
          )}
        </div>
      </div>

      {shared && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-border bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">共用券號</span>
          <span className="font-mono text-base font-semibold text-foreground">{coupon.sharedCode || '—'}</span>
          {coupon.sharedCode && (
            <Button variant="outline" size="xs" onClick={() => copyCode(coupon.sharedCode!, '已複製共用券號')}>
              複製
            </Button>
          )}
          <span className="basis-full text-xs text-muted-foreground">所有顧客使用同一組券號，下方列出領取與使用紀錄</span>
        </div>
      )}

      {imported && (
        <p className="rounded-[10px] border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {poolSize != null && issuedCount != null
            ? `序號包共 ${formatNumber(poolSize)} 組，已發放 ${formatNumber(issuedCount)} 組，僅顯示已發放序號`
            : issuedCount != null
              ? `已發放 ${formatNumber(issuedCount)} 組，僅顯示已發放序號`
              : '僅顯示已發放序號'}
        </p>
      )}

      {/* 篩選列 */}
      {/* 日期欄位有瀏覽器內建的最小寬度，四欄排一列在 1440 寬會溢出框外，故固定兩欄 */}
      <div className="grid gap-3 rounded-[10px] border border-border bg-muted/40 p-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="instance-search" className="text-xs font-medium text-foreground">
            {searchLabel}
          </label>
          <input
            id="instance-search"
            type="search"
            className={inputClass}
            value={filters.q}
            placeholder={placeholder}
            onChange={(e) => updateFilter('q', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="instance-status" className="text-xs font-medium text-foreground">
            狀態
          </label>
          <select
            id="instance-status"
            className={inputClass}
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value as InstanceStatus | '')}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <DateRange
          label="領取時間"
          idPrefix="claimed"
          from={filters.claimedFrom}
          to={filters.claimedTo}
          onFrom={(v) => updateFilter('claimedFrom', v)}
          onTo={(v) => updateFilter('claimedTo', v)}
        />
        <DateRange
          label="核銷時間"
          idPrefix="redeemed"
          from={filters.redeemedFrom}
          to={filters.redeemedTo}
          onFrom={(v) => updateFilter('redeemedFrom', v)}
          onTo={(v) => updateFilter('redeemedTo', v)}
        />
      </div>

      {/* 表格：窄螢幕可橫向捲動；寬螢幕取消捲動容器，讓表頭能貼齊頁面頂端 */}
      <div className="overflow-x-auto rounded-[10px] border border-border xl:overflow-visible">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-muted-foreground">
              {!shared && <Th>序號</Th>}
              <Th>顧客名稱</Th>
              <Th>發放來源</Th>
              <Th>狀態</Th>
              <Th>領取時間</Th>
              <Th>核銷時間</Th>
            </tr>
          </thead>
          <tbody aria-busy={isLoading}>
            {error && !meta ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center">
                  <div role="alert" className="space-y-3">
                    <p className="font-medium text-foreground">序號明細載入失敗</p>
                    <p className="text-sm text-muted-foreground">{getApiErrorMessage(error, '請確認網路後重試')}</p>
                    <Button variant="outline" size="sm" onClick={() => mutate()}>
                      重試
                    </Button>
                  </div>
                </td>
              </tr>
            ) : isLoading && !meta ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-t border-border">
                  {Array.from({ length: colCount }, (__, j) => (
                    <td key={j} className="px-4 py-4">
                      <div className="h-4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : instances.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center">
                  {filtered ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">沒有符合條件的序號</p>
                      <p className="text-sm text-muted-foreground">請確認顧客提供的券號，或調整搜尋與篩選條件</p>
                      <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2">
                        清除篩選
                      </Button>
                    </div>
                  ) : (
                    <p className="font-medium text-muted-foreground">尚未發放任何序號</p>
                  )}
                </td>
              </tr>
            ) : (
              instances.map((row) => (
                <InstanceRow
                  key={row.id}
                  row={row}
                  shared={shared}
                  onOpen={openDrawer}
                  onCopy={(code) => copyCode(code, `已複製序號 ${code}`)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <nav aria-label="序號明細分頁" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            共 {formatNumber(total)} 筆，顯示第 {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} 筆
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              上一頁
            </Button>
            <span aria-live="polite" className="tabular-nums">
              第 {page} / {totalPages} 頁
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一頁
            </Button>
          </div>
        </nav>
      )}

      {openRow && <InstanceHistoryDrawer row={openRow} shared={shared} onClose={closeDrawer} />}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="whitespace-nowrap bg-muted px-4 py-3 font-medium xl:sticky xl:top-0 xl:z-10">
      {children}
    </th>
  );
}

function DateRange({
  label,
  idPrefix,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  idPrefix: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="text-xs font-medium text-foreground">{label}</legend>
      <div className="flex items-center gap-1.5">
        <input
          id={`${idPrefix}-from`}
          type="date"
          aria-label={`${label}起`}
          className={cn(inputClass, 'min-w-0 flex-1')}
          value={from}
          max={to || undefined}
          onChange={(e) => onFrom(e.target.value)}
        />
        <span aria-hidden="true" className="text-muted-foreground">
          –
        </span>
        <input
          id={`${idPrefix}-to`}
          type="date"
          aria-label={`${label}迄`}
          className={cn(inputClass, 'min-w-0 flex-1')}
          value={to}
          min={from || undefined}
          onChange={(e) => onTo(e.target.value)}
        />
      </div>
    </fieldset>
  );
}

function InstanceRow({
  row,
  shared,
  onOpen,
  onCopy,
}: {
  row: CouponInstanceRow;
  shared: boolean;
  onOpen: (row: CouponInstanceRow, el: HTMLElement) => void;
  onCopy: (code: string) => void;
}) {
  const source = issuedSourceLines(row);
  return (
    <tr
      tabIndex={0}
      aria-haspopup="dialog"
      onClick={(e) => onOpen(row, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(row, e.currentTarget);
        }
      }}
      className="cursor-pointer border-t border-border transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {!shared && (
        <td className="px-4 py-3">
          <button
            type="button"
            title={`${row.code}（點擊複製）`}
            aria-label={`複製序號 ${row.code}`}
            onClick={(e) => {
              e.stopPropagation();
              onCopy(row.code);
            }}
            className="block max-w-[220px] truncate rounded font-mono text-[13px] text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.code}
          </button>
        </td>
      )}
      <td className="px-4 py-3 text-foreground">{row.contact?.displayName || '—'}</td>
      <td className="px-4 py-3">
        <div className="text-foreground">{source.primary}</div>
        {source.secondary && <div className="text-xs text-muted-foreground">{source.secondary}</div>}
      </td>
      <td className="px-4 py-3">
        <InstanceStatusBadge status={row.status} />
      </td>
      <td className={cn('whitespace-nowrap px-4 py-3 font-mono text-[13px]', row.claimedAt ? 'text-foreground' : 'text-muted-foreground')}>
        {formatDateTime(row.claimedAt)}
      </td>
      <td className={cn('whitespace-nowrap px-4 py-3 font-mono text-[13px]', row.redeemedAt ? 'text-foreground' : 'text-muted-foreground')}>
        {formatDateTime(row.redeemedAt)}
      </td>
    </tr>
  );
}
