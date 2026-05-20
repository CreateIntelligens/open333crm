'use client';

/**
 * LineCarouselEditor — LINE 多頁訊息（Carousel）編輯器。
 *
 * 對齊 LINE OA 後台「多頁訊息」UI：
 *   - 頁面類型切換（4 選 1：商品服務 / 地點 / 人物 / 圖文）
 *   - 多頁面 tab + 新增/刪除/排序
 *   - 每頁固定欄位（依 pageType 不同）
 *   - 結尾頁開關
 */

import React, { useState } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CompactImageField } from '../CompactImageField';
import { ActionConfigEditor } from './ActionConfigEditor';
import {
  PAGE_TYPE_OPTIONS,
  LABEL_COLORS,
  createEmptyPage,
  type CarouselBody,
  type CarouselPage,
  type CarouselPageType,
} from './carousel-page-types';

interface Props {
  body: CarouselBody;
  onChange: (next: CarouselBody) => void;
}

export function LineCarouselEditor({ body, onChange }: Props) {
  const pages = body.pages ?? [];
  const [currentIdx, setCurrentIdx] = useState(0);
  const currentPage = pages[currentIdx];

  const updatePage = (idx: number, next: CarouselPage) => {
    const newPages = [...pages];
    newPages[idx] = next;
    onChange({ ...body, pages: newPages });
  };

  const addPage = () => {
    if (pages.length >= 10) return;
    const newPage = createEmptyPage(body.pageType);
    onChange({ ...body, pages: [...pages, newPage] });
    setCurrentIdx(pages.length);
  };

  const removePage = (idx: number) => {
    if (pages.length <= 1) return;
    const newPages = pages.filter((_, i) => i !== idx);
    onChange({ ...body, pages: newPages });
    setCurrentIdx(Math.min(idx, newPages.length - 1));
  };

  const duplicatePage = (idx: number) => {
    if (pages.length >= 10) return;
    const copied = JSON.parse(JSON.stringify(pages[idx])) as CarouselPage;
    const newPages = [...pages.slice(0, idx + 1), copied, ...pages.slice(idx + 1)];
    onChange({ ...body, pages: newPages });
    setCurrentIdx(idx + 1);
  };

  const movePage = (from: number, to: number) => {
    if (to < 0 || to >= pages.length) return;
    const newPages = [...pages];
    [newPages[from], newPages[to]] = [newPages[to], newPages[from]];
    onChange({ ...body, pages: newPages });
    setCurrentIdx(to);
  };

  const changePageType = (newType: CarouselPageType) => {
    if (newType === body.pageType) return;
    if (!confirm('切換頁面類型會清空目前所有頁面內容，確定嗎？')) return;
    onChange({ pageType: newType, pages: [createEmptyPage(newType)] });
    setCurrentIdx(0);
  };

  return (
    <div className="space-y-4">
      {/* 頁面類型選擇 */}
      <div className="rounded-md border border-slate-200 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">頁面類型</div>
        <div className="grid grid-cols-4 gap-2">
          {PAGE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => changePageType(opt.value)}
              className={`rounded-md border p-2 text-left transition-colors ${
                body.pageType === opt.value
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white hover:border-slate-400'
              }`}
            >
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className={`mt-0.5 text-[10px] ${body.pageType === opt.value ? 'text-slate-300' : 'text-slate-500'}`}>
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 頁面 tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-1">
        {pages.map((_, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setCurrentIdx(idx)}
            className={`shrink-0 rounded-t-md border border-b-0 px-3 py-1 text-xs ${
              idx === currentIdx ? 'border-slate-900 bg-white font-semibold' : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            第 {idx + 1} 頁
          </button>
        ))}
        {pages.length < 10 && (
          <Button variant="ghost" size="sm" onClick={addPage}>
            <Plus className="h-3 w-3 mr-1" />新增頁面
          </Button>
        )}
      </div>

      {/* 目前頁面工具列 */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => movePage(currentIdx, currentIdx - 1)} disabled={currentIdx === 0}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => movePage(currentIdx, currentIdx + 1)} disabled={currentIdx === pages.length - 1}>
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => duplicatePage(currentIdx)} disabled={pages.length >= 10}>
            <Copy className="h-3 w-3 mr-1" />複製
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => removePage(currentIdx)} disabled={pages.length <= 1}>
          <Trash2 className="h-3 w-3 mr-1 text-red-600" />刪除此頁
        </Button>
      </div>

      {/* 頁面欄位編輯 */}
      {currentPage && (
        <PageFieldsEditor
          pageType={body.pageType}
          page={currentPage}
          onChange={(next) => updatePage(currentIdx, next)}
        />
      )}

      {/* 結尾頁 */}
      <EndPageEditor body={body} onChange={onChange} />
    </div>
  );
}

// ─── 頁面欄位編輯（依 pageType） ─────────────────────────

function PageFieldsEditor({ pageType, page, onChange }: { pageType: CarouselPageType; page: CarouselPage; onChange: (next: CarouselPage) => void }) {
  return (
    <div className="space-y-4 rounded-md border border-slate-200 p-4">
      {/* 標籤（所有 pageType 都有） */}
      <FieldRow
        toggleable
        enabled={!!page.label}
        onToggle={(e) => onChange({ ...page, label: e ? { text: '', bgColor: LABEL_COLORS[0] } : undefined })}
        label="標籤"
      >
        {page.label && <LabelEditor value={page.label} onChange={(label) => onChange({ ...page, label })} placeholder={pageType === 'person' ? '輸入人物特點' : '輸入標籤文字'} />}
      </FieldRow>

      {/* 圖片（共用，必選） */}
      <FieldRow label="圖片">
        <CompactImageField value={page.imageUrl ?? ''} onChange={(imageUrl) => onChange({ ...page, imageUrl: imageUrl || undefined })} />
      </FieldRow>

      {/* 人物：姓名（必填） */}
      {pageType === 'person' && (
        <FieldRow label="姓名">
          <CountedInput value={page.name ?? ''} onChange={(v) => onChange({ ...page, name: v })} maxLength={20} placeholder="輸入姓名" />
        </FieldRow>
      )}

      {/* 人物：特點 1-3 */}
      {pageType === 'person' && <PersonTagsField page={page} onChange={onChange} />}

      {/* 頁面標題（非人物） */}
      {pageType !== 'person' && (
        <FieldRow label="頁面標題">
          <CountedInput value={page.title ?? ''} onChange={(v) => onChange({ ...page, title: v })} maxLength={20} placeholder="輸入標題" />
        </FieldRow>
      )}

      {/* 文字說明 */}
      <FieldRow
        toggleable
        enabled={page.description !== undefined}
        onToggle={(e) => onChange({ ...page, description: e ? '' : undefined })}
        label="文字說明"
      >
        {page.description !== undefined && (
          <div>
            <Textarea
              value={page.description}
              onChange={(e) => onChange({ ...page, description: e.target.value })}
              maxLength={60}
              rows={2}
              placeholder="輸入文字說明"
            />
            <CharCount current={page.description.length} max={60} />
          </div>
        )}
      </FieldRow>

      {/* 商品：價格 */}
      {pageType === 'product' && (
        <FieldRow
          toggleable
          enabled={!!page.price}
          onToggle={(e) => onChange({ ...page, price: e ? { currency: 'NT$', amount: '' } : undefined })}
          label="價格"
        >
          {page.price && (
            <div className="flex items-center gap-2">
              <select
                value={page.price.currency}
                onChange={(e) => onChange({ ...page, price: { ...page.price!, currency: e.target.value as 'NT$' | '$' | '¥' } })}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm w-24"
              >
                <option value="NT$">NT $</option>
                <option value="$">$</option>
                <option value="¥">¥</option>
              </select>
              <div className="flex-1">
                <CountedInput
                  value={page.price.amount}
                  onChange={(v) => onChange({ ...page, price: { ...page.price!, amount: v } })}
                  maxLength={15}
                  placeholder="00,000"
                />
              </div>
            </div>
          )}
        </FieldRow>
      )}

      {/* 地點：地址 */}
      {pageType === 'location' && (
        <FieldRow
          toggleable
          enabled={page.address !== undefined}
          onToggle={(e) => onChange({ ...page, address: e ? '' : undefined })}
          label="地址"
        >
          {page.address !== undefined && (
            <div>
              <Textarea
                value={page.address}
                onChange={(e) => onChange({ ...page, address: e.target.value })}
                maxLength={60}
                rows={2}
                placeholder="輸入地址"
              />
              <CharCount current={page.address.length} max={60} />
            </div>
          )}
        </FieldRow>
      )}

      {/* 地點：相關資訊 */}
      {pageType === 'location' && (
        <FieldRow
          toggleable
          enabled={!!page.extraInfo}
          onToggle={(e) => onChange({ ...page, extraInfo: e ? { type: '時間', value: '' } : undefined })}
          label="相關資訊"
        >
          {page.extraInfo && (
            <div className="flex items-center gap-2">
              <select
                value={page.extraInfo.type}
                onChange={(e) => onChange({ ...page, extraInfo: { ...page.extraInfo!, type: e.target.value as '時間' | '電話' | '其他' } })}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm w-24"
              >
                <option value="時間">時間</option>
                <option value="電話">電話</option>
                <option value="其他">其他</option>
              </select>
              <div className="flex-1">
                <CountedInput
                  value={page.extraInfo.value}
                  onChange={(v) => onChange({ ...page, extraInfo: { ...page.extraInfo!, value: v } })}
                  maxLength={30}
                  placeholder="輸入資訊"
                />
              </div>
            </div>
          )}
        </FieldRow>
      )}

      {/* 動作 1（必填） */}
      <FieldRow label="動作 1（必填）" required>
        <ActionConfigEditor action={page.action1} onChange={(action1) => onChange({ ...page, action1 })} labelLimit={15} />
      </FieldRow>

      {/* 動作 2（選填） */}
      <FieldRow
        toggleable
        enabled={!!page.action2}
        onToggle={(e) => onChange({ ...page, action2: e ? { type: 'uri', label: '', uri: '' } : undefined })}
        label="動作 2"
      >
        {page.action2 && (
          <ActionConfigEditor
            action={page.action2}
            onChange={(action2) => onChange({ ...page, action2 })}
            labelLimit={15}
          />
        )}
      </FieldRow>
    </div>
  );
}

// ─── 共用：FieldRow / 勾選欄位 / 字數欄位 ─────────────────

interface FieldRowProps {
  label: string;
  toggleable?: boolean;
  enabled?: boolean;
  onToggle?: (next: boolean) => void;
  required?: boolean;
  children?: React.ReactNode;
}

function FieldRow({ label, toggleable, enabled, onToggle, required, children }: FieldRowProps) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div className="pt-2">
        {toggleable ? (
          <button
            type="button"
            onClick={() => onToggle?.(!enabled)}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                enabled ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'
              }`}
            >
              {enabled && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            {label}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-700">
            {required && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
            {label}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function CountedInput({ value, onChange, maxLength, placeholder }: { value: string; onChange: (v: string) => void; maxLength: number; placeholder?: string }) {
  return (
    <div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={placeholder} />
      <CharCount current={value.length} max={maxLength} />
    </div>
  );
}

function CharCount({ current, max }: { current: number; max: number }) {
  return <div className="mt-0.5 text-right text-[11px] text-slate-400 tabular-nums">{current}/{max}</div>;
}

// ─── 標籤編輯（在 FieldRow 內顯示） ───────────────────────

function LabelEditor({ value, onChange, placeholder }: { value: { text: string; bgColor: string }; onChange: (next: { text: string; bgColor: string }) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={value.text}
          maxLength={12}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder={placeholder}
          className="flex-1"
        />
        <span className="text-[11px] text-slate-400 tabular-nums w-12 text-right">{value.text.length}/12</span>
      </div>
      <div className="flex items-center gap-1.5">
        {LABEL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange({ ...value, bgColor: color })}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${value.bgColor === color ? 'border-slate-900' : 'border-slate-200'}`}
            style={{ backgroundColor: color }}
            aria-label={`color ${color}`}
          >
            {value.bgColor === color && (
              <Check
                className="h-3.5 w-3.5"
                strokeWidth={3}
                style={{ color: color === '#ffffff' ? '#27272a' : '#ffffff' }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 人物標籤 1-3 ────────────────────────────────────

function PersonTagsField({ page, onChange }: { page: CarouselPage; onChange: (next: CarouselPage) => void }) {
  const tags = page.tags ?? [];
  const updateTag = (idx: number, next: { text: string; color: string } | null) => {
    if (next === null) {
      onChange({ ...page, tags: tags.filter((_, i) => i !== idx) });
    } else {
      const newTags = [...tags];
      newTags[idx] = next;
      onChange({ ...page, tags: newTags });
    }
  };
  const addTag = () => {
    if (tags.length >= 3) return;
    onChange({ ...page, tags: [...tags, { text: '', color: LABEL_COLORS[0] }] });
  };

  return (
    <>
      {[0, 1, 2].map((idx) => {
        const tag = tags[idx];
        const enabled = !!tag;
        return (
          <FieldRow
            key={idx}
            toggleable
            enabled={enabled}
            onToggle={(e) => {
              if (e && !enabled) addTag();
              else if (!e && enabled) updateTag(idx, null);
            }}
            label={`人物特點 ${idx + 1}`}
          >
            {tag && <LabelEditor value={{ text: tag.text, bgColor: tag.color }} onChange={(v) => updateTag(idx, { text: v.text, color: v.bgColor })} placeholder="輸入人物特點" />}
          </FieldRow>
        );
      })}
    </>
  );
}

// ─── 結尾頁 ─────────────────────────────────────────

function EndPageEditor({ body, onChange }: { body: CarouselBody; onChange: (next: CarouselBody) => void }) {
  const enabled = !!body.endPage;
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <button
        type="button"
        onClick={() =>
          onChange({
            ...body,
            endPage: enabled
              ? undefined
              : { imageUrl: '', label: '了解更多', action: { type: 'uri', label: '了解更多', uri: '' } },
          })
        }
        className="flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            enabled ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white'
          }`}
        >
          {enabled && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        新增結尾頁
      </button>
      {body.endPage && (
        <div className="mt-4 space-y-4">
          <FieldRow label="圖片">
            <CompactImageField value={body.endPage.imageUrl ?? ''} onChange={(url) => onChange({ ...body, endPage: { ...body.endPage!, imageUrl: url || undefined } })} />
          </FieldRow>
          <FieldRow label="CTA 按鈕文字">
            <CountedInput
              value={body.endPage.label ?? ''}
              onChange={(v) => onChange({ ...body, endPage: { ...body.endPage!, label: v } })}
              maxLength={15}
              placeholder="如：了解更多"
            />
          </FieldRow>
          <FieldRow label="動作" required>
            <ActionConfigEditor
              action={body.endPage.action}
              onChange={(action) => onChange({ ...body, endPage: { ...body.endPage!, action } })}
              labelLimit={15}
            />
          </FieldRow>
        </div>
      )}
    </div>
  );
}
