'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FilterValues {
  statuses: string[];
  channels: string[];
  assignee: string; // '' = all, 'mine' = my conversations, 'unassigned', or specific agent id
}

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  agentId?: string;
}

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: '進行中' },
  { value: 'BOT_HANDLED', label: 'Bot 處理中' },
  { value: 'AGENT_HANDLED', label: '等待客服' },
  { value: 'CLOSED', label: '已關閉' },
];

const CHANNEL_OPTIONS = [
  { value: 'LINE', label: 'LINE' },
  { value: 'FB', label: 'Facebook' },
  { value: 'WEBCHAT', label: 'WebChat' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
];

const ASSIGNEE_OPTIONS = [
  { value: '', label: '所有' },
  { value: 'mine', label: '我的對話' },
  { value: 'unassigned', label: '未指派' },
];

export function FilterDrawer({ open, onClose, values, onChange }: FilterDrawerProps) {
  const [draft, setDraft] = useState<FilterValues>(values);

  // Reset draft when opening
  React.useEffect(() => {
    if (open) { setDraft(values); }
  }, [open, values]);

  const toggleStatus = (status: string) => {
    setDraft((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  };

  const toggleChannel = (channel: string) => {
    setDraft((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter((c) => c !== channel)
        : [...prev.channels, channel],
    }));
  };

  const handleApply = () => {
    onChange(draft);
    onClose();
  };

  const handleClear = () => {
    const empty: FilterValues = { statuses: [], channels: [], assignee: '' };
    setDraft(empty);
    onChange(empty);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <button type="button" aria-label="關閉篩選" className="fixed inset-0 z-40 bg-black/20 cursor-default" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed left-0 top-0 z-50 h-full w-[260px] transform bg-background shadow-lg transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">進階篩選</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Status */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                對話狀態
              </h4>
              <div className="space-y-1.5">
                {STATUS_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.statuses.includes(opt.value)}
                      onChange={() => toggleStatus(opt.value)}
                      className="rounded border-gray-300"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Channel */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                渠道
              </h4>
              <div className="space-y-1.5">
                {CHANNEL_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.channels.includes(opt.value)}
                      onChange={() => toggleChannel(opt.value)}
                      className="rounded border-gray-300"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Assignee */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                指派
              </h4>
              <select
                value={draft.assignee}
                onChange={(e) => setDraft((prev) => ({ ...prev, assignee: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                {ASSIGNEE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t p-4 space-y-2">
            <Button className="w-full" size="sm" onClick={handleApply}>
              套用篩選
            </Button>
            <Button variant="ghost" className="w-full" size="sm" onClick={handleClear}>
              清除全部
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
