'use client';

import React from 'react';
import { format } from 'date-fns';
import { Loader2, Send, Edit, Trash2, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';

interface Template {
  id: string;
  name: string;
  description: string | null;
  category: string;
  channelType: string;
  contentType: string;
  body: Record<string, unknown>;
  usageCount: number;
  isSystem: boolean;
  updatedAt: string;
}

interface TemplateListProps {
  templates: Template[];
  isLoading: boolean;
  onEdit: (template: Template) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (template: Template) => void;
}

const channelTypeLabel: Record<string, string> = {
  universal: '通用',
  LINE: 'LINE',
  FB: 'Facebook',
  WEBCHAT: 'WebChat',
  WHATSAPP: 'WhatsApp',
};

export function TemplateList({
  templates,
  isLoading,
  onEdit,
  onDelete,
  onDuplicate,
}: TemplateListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-ink-subtle" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<Send className="h-12 w-12" />}
        title="尚無範本"
        description="點擊「新增範本」開始建立訊息範本"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-surface-line bg-surface-canvas text-left">
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              名稱
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              分類
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              渠道
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              類型
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              使用次數
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              更新時間
            </th>
            <th className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr
              key={template.id}
              className="border-b border-surface-line transition-colors hover:bg-neutral-20"
            >
              <td className="px-4 py-3">
                <div>
                  <p className="text-[14px] font-medium text-ink">
                    {template.name}
                    {template.isSystem && (
                      <Badge variant="outline" className="ml-2 text-[11px]">
                        系統
                      </Badge>
                    )}
                  </p>
                  {template.description && (
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-ink-subtle">
                      {template.description}
                    </p>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant="outline">{template.category}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge variant="secondary">
                  {channelTypeLabel[template.channelType] || template.channelType}
                </Badge>
              </td>
              <td className="px-4 py-3 text-[14px] text-ink-subtle">
                {template.contentType}
              </td>
              <td className="px-4 py-3 text-[14px] text-ink-subtle">
                {template.usageCount}
              </td>
              <td className="px-4 py-3 text-[13px] text-ink-subtle">
                {format(new Date(template.updatedAt), 'MMM d, HH:mm')}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  {onDuplicate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDuplicate(template)}
                      title="複製"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  )}
                  {!template.isSystem && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(template)}
                        title="編輯"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(template.id)}
                        title="刪除"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
