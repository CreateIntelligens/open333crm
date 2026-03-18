'use client';

import React from 'react';
import { format } from 'date-fns';
import { Loader2, Send, Edit, Trash2 } from 'lucide-react';
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
}: TemplateListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              名稱
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              分類
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              渠道
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              類型
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              使用次數
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              更新時間
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr
              key={template.id}
              className="border-b transition-colors hover:bg-muted/50"
            >
              <td className="px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {template.name}
                    {template.isSystem && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        系統
                      </Badge>
                    )}
                  </p>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
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
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {template.contentType}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {template.usageCount}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {format(new Date(template.updatedAt), 'MMM d, HH:mm')}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
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
