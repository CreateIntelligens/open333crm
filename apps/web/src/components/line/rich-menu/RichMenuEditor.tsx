'use client';

/**
 * Rich Menu 編輯器主元件（左右雙欄）
 *
 * 左欄：① 基本資訊 ② 背景圖 ③ 區域設定（可展開的區域卡片）
 * 右欄：即時預覽（手機外框，捲動時固定；點格子跳到對應區域）
 * 版面依 Claude Design「Rich Menu 編輯器（新增步驟 2 與編輯共用）」。
 */

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CompactImageField } from '@/components/materials/CompactImageField';
import { RichMenuPreview } from './RichMenuPreview';
import { AreaActionEditor, Field } from './AreaActionEditor';
import type { RichMenuArea, RichMenuAction } from '@/hooks/useRichMenus';
import {
  LINE_RICH_MENU_MAX_IMAGE_BYTES,
  LINE_RICH_MENU_MIN_WIDTH,
  LINE_RICH_MENU_MAX_WIDTH,
  LINE_RICH_MENU_MIN_HEIGHT,
} from '@open333crm/shared';
import { RICH_MENU_DEFAULT_CHECK_CONFIRM } from '@/lib/rich-menu-confirm';

export interface RichMenuDraft {
  channelId: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  /** 聊天室打開時是否展開選單（LINE 的 selected） */
  selected: boolean;
  /** 發布時是否設成所有好友的預設選單 */
  isDefault: boolean;
  areas: RichMenuArea[];
  imageUrl: string;
}

interface Props {
  draft: RichMenuDraft;
  onChange: (next: RichMenuDraft) => void;
}

export function RichMenuEditor({ draft, onChange }: Props) {
  const [expandedAreaIdx, setExpandedAreaIdx] = useState<number | null>(0);

  const updateArea = (idx: number, action: RichMenuAction) => {
    const newAreas = [...draft.areas];
    newAreas[idx] = { ...newAreas[idx], action };
    onChange({ ...draft, areas: newAreas });
  };

  // 點預覽上的格子：展開對應區域並捲到那裡
  const focusArea = (idx: number) => {
    setExpandedAreaIdx(idx);
    requestAnimationFrame(() => {
      document.getElementById(`rich-menu-area-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* 左欄：表單 */}
      <div className="min-w-0 space-y-5">
        <Section step={1} title="基本資訊">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="名稱" required hint="CRM 內部使用，好友看不到">
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(e) => onChange({ ...draft, name: e.target.value })}
                  maxLength={200}
                  placeholder="如：主選單 v1"
                />
              )}
            </Field>
            <Field
              label="底部按鈕文字"
              required
              counter={`${draft.chatBarText.length} / 14`}
              hint="好友在 LINE 聊天室底部看到的文字，最多 14 字"
            >
              {(id) => (
                <Input
                  id={id}
                  value={draft.chatBarText}
                  onChange={(e) => onChange({ ...draft, chatBarText: e.target.value })}
                  maxLength={14}
                  placeholder="如：菜單"
                />
              )}
            </Field>
          </div>

          <div className="space-y-4 pt-1">
            <CheckOption
              label="設為所有好友的預設選單"
              checked={draft.isDefault}
              onCheckedChange={(next) => {
                // 勾選會影響所有好友，先確認；取消勾選不需要
                if (next && !confirm(RICH_MENU_DEFAULT_CHECK_CONFIRM)) return;
                onChange({ ...draft, isDefault: next });
              }}
              description="勾選後，發布時會換掉這個官方帳號所有好友目前看到的選單。只想給部分好友看，請不要勾，發布後用「綁定受眾」。"
            />
            <CheckOption
              label="聊天室打開時展開選單"
              checked={draft.selected}
              onCheckedChange={(next) => onChange({ ...draft, selected: next })}
              description={`不勾時選單收合，好友點聊天室底部的「${draft.chatBarText || '選單'}」才會打開。`}
            />
          </div>
        </Section>

        <Section step={2} title="背景圖">
          <CompactImageField
            value={draft.imageUrl}
            onChange={(imageUrl) => onChange({ ...draft, imageUrl })}
            // LINE 對 Rich Menu 背景圖的硬限制是 1MB（官方文件
            // Requirements for rich menu image）。後端 /files/upload 允許 25MB，
            // 不在這裡擋的話使用者會看到「上傳成功」，直到按發布才收到 400。
            maxBytes={LINE_RICH_MENU_MAX_IMAGE_BYTES}
            requireAspectRatio={draft.size}
            // LINE 對 Rich Menu 圖的像素範圍要求；不擋的話要到按發布才被退件
            pixelLimits={{
              minWidth: LINE_RICH_MENU_MIN_WIDTH,
              maxWidth: LINE_RICH_MENU_MAX_WIDTH,
              minHeight: LINE_RICH_MENU_MIN_HEIGHT,
            }}
          />
          <p className="text-sm text-muted-foreground">
            需求尺寸 {draft.size.width} × {draft.size.height}（JPEG/PNG，≤ 1 MB，LINE 官方限制）。
            圖片會依版型切成 {draft.areas.length} 個可點擊區域，請讓圖上的按鈕位置對齊右側預覽的格線。
          </p>
        </Section>

        <Section step={3} title="區域設定" meta={`共 ${draft.areas.length} 個`}>
          <ul className="space-y-3">
            {draft.areas.map((area, idx) => {
              const isExpanded = expandedAreaIdx === idx;
              const panelId = `rich-menu-area-panel-${idx}`;
              return (
                <li
                  key={idx}
                  id={`rich-menu-area-${idx}`}
                  className={
                    'scroll-mt-4 overflow-hidden rounded-lg border bg-background ' +
                    (isExpanded ? 'border-2 border-primary' : 'border-border')
                  }
                >
                  <button
                    type="button"
                    onClick={() => setExpandedAreaIdx(isExpanded ? null : idx)}
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      className={
                        'flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold ' +
                        (isExpanded ? 'bg-primary text-white' : 'bg-shell text-foreground')
                      }
                      aria-hidden="true"
                    >
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-foreground">區域 {idx + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{actionSummary(area.action)}</span>
                    <ChevronDown
                      className={'h-4 w-4 flex-none text-muted-foreground transition-transform ' + (isExpanded ? 'rotate-180' : '')}
                      aria-hidden="true"
                    />
                  </button>
                  {isExpanded && (
                    <div id={panelId} className="border-t border-border px-4 py-4">
                      <AreaActionEditor action={area.action} onChange={(action) => updateArea(idx, action)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>

      {/* 右欄：預覽 */}
      <aside aria-label="即時預覽" className="min-w-0">
        <div className="sticky top-0 rounded-lg border border-border bg-muted p-5">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 className="text-base font-semibold text-foreground">即時預覽</h2>
            <span className="text-xs text-muted-foreground">點格子可跳到對應的區域</span>
          </div>
          <RichMenuPreview
            imageUrl={draft.imageUrl}
            size={draft.size}
            areas={draft.areas}
            chatBarText={draft.chatBarText}
            activeIndex={expandedAreaIdx}
            onAreaClick={focusArea}
          />
          <div className="mt-4 space-y-1 text-center text-xs text-muted-foreground">
            <p className="tabular-nums">尺寸：{draft.size.width} × {draft.size.height}</p>
            <p>好友打開聊天室時，選單預設為{draft.selected ? '展開' : '收合'}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Section({
  step,
  title,
  meta,
  children,
}: {
  step: number;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-background p-6">
      <h2 className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary" aria-hidden="true">
          {step}
        </span>
        <span className="text-lg font-semibold text-foreground">{title}</span>
        {meta && <span className="text-sm font-normal text-muted-foreground">{meta}</span>}
      </h2>
      {children}
    </section>
  );
}

function CheckOption({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </label>
      <p className="mt-1 pl-7 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  postback: '回傳資料',
  message: '傳送訊息',
  uri: '開啟網址',
  datetimepicker: '日期時間',
  richmenuswitch: '切換 Rich Menu',
};

/** 區域卡片標題列的摘要：類型 · 標籤 · 主要內容 */
function actionSummary(action: RichMenuAction): string {
  const value =
    action.type === 'uri' ? action.uri
      : action.type === 'message' ? action.text
        : action.type === 'richmenuswitch' ? action.richMenuAliasId
          : action.data;
  return [TYPE_LABELS[action.type] || action.type, action.label, value].filter(Boolean).join(' · ');
}
