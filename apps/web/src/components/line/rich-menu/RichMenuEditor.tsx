'use client';

/**
 * Rich Menu 編輯器主元件（左右雙欄）
 *
 * 左欄：基本資訊 + 背景圖上傳 + 區域 action 列表
 * 右欄：即時預覽
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CompactImageField } from '@/components/materials/CompactImageField';
import { RichMenuPreview } from './RichMenuPreview';
import { AreaActionEditor } from './AreaActionEditor';
import type { RichMenuArea, RichMenuAction } from '@/hooks/useRichMenus';

export interface RichMenuDraft {
  channelId: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  selected: boolean;
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

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
      {/* 左欄：表單 */}
      <div className="space-y-4">
        <Section title="基本資訊">
          <div>
            <Label>名稱 *（CRM 內部使用）</Label>
            <Input
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              maxLength={200}
              placeholder="如：主選單 v1"
            />
          </div>
          <div>
            <Label>底部按鈕文字 *（≤ 14 字，使用者在 LINE 看到）</Label>
            <Input
              value={draft.chatBarText}
              onChange={(e) => onChange({ ...draft, chatBarText: e.target.value })}
              maxLength={14}
              placeholder="如：菜單"
            />
            <div className="mt-0.5 text-[10px] text-slate-400">
              {draft.chatBarText.length} / 14
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.selected}
                onChange={(e) => onChange({ ...draft, selected: e.target.checked })}
              />
              <span>預設展開選單（使用者開啟對話時自動展開）</span>
            </label>
          </div>
        </Section>

        <Section title="背景圖">
          <div className="space-y-2">
            <CompactImageField
              value={draft.imageUrl}
              onChange={(imageUrl) => onChange({ ...draft, imageUrl })}
            />
            <div className="text-[11px] text-slate-500">
              ⚠ 建議尺寸 {draft.size.width} × {draft.size.height}（JPEG/PNG，≤ 1 MB）
            </div>
          </div>
        </Section>

        <Section title={`區域設定（共 ${draft.areas.length} 個）`}>
          <div className="space-y-2">
            {draft.areas.map((area, idx) => {
              const isExpanded = expandedAreaIdx === idx;
              return (
                <div key={idx} className="rounded-md border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setExpandedAreaIdx(isExpanded ? null : idx)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      區域 {idx + 1}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {actionLabel(area.action)}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-200 p-2">
                      <AreaActionEditor
                        action={area.action}
                        onChange={(action) => updateArea(idx, action)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* 右欄：預覽 */}
      <div className="space-y-2">
        <div className="sticky top-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            即時預覽
          </div>
          <RichMenuPreview
            imageUrl={draft.imageUrl}
            size={draft.size}
            areas={draft.areas}
          />
          <div className="mt-2 text-[11px] text-slate-400">
            尺寸：{draft.size.width} × {draft.size.height}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-slate-600">{children}</label>;
}

function actionLabel(action: RichMenuAction): string {
  const typeLabels: Record<string, string> = {
    postback: '回傳資料',
    message: '傳送訊息',
    uri: '開啟網址',
    datetimepicker: '日期時間',
    richmenuswitch: '切換 Rich Menu',
  };
  const t = typeLabels[action.type] || action.type;
  return action.label ? `${t}：${action.label}` : t;
}
