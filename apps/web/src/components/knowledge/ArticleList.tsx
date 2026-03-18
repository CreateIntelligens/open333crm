'use client';

import React from 'react';
import { format } from 'date-fns';
import { Loader2, BookOpen, Edit, Globe, Archive, Trash2, Brain } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';

interface Article {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  status: string;
  viewCount: number;
  updatedAt: string;
  hasEmbedding?: boolean;
}

interface ArticleListProps {
  articles: Article[];
  isLoading: boolean;
  onEdit: (article: Article) => void;
  onPublish: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

const statusLabel: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已發布',
  ARCHIVED: '已封存',
};

const statusVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
};

export function ArticleList({
  articles,
  isLoading,
  onEdit,
  onPublish,
  onArchive,
  onDelete,
}: ArticleListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-12 w-12" />}
        title="尚無文章"
        description="點擊「新增文章」開始建立知識庫"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              標題
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              分類
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              狀態
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              標籤
            </th>
            <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
              瀏覽數
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
          {articles.map((article) => (
            <tr key={article.id} className="border-b transition-colors hover:bg-muted/50">
              <td className="px-4 py-3">
                <div className="flex items-start gap-1.5">
                  {article.hasEmbedding && (
                    <span title="已向量化">
                      <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                    </span>
                  )}
                  <div>
                    <p className="text-sm font-medium">{article.title}</p>
                    {article.summary && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                        {article.summary}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant="outline">{article.category}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge variant={statusVariant[article.status] || 'secondary'}>
                  {statusLabel[article.status] || article.status}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {article.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {article.tags.length > 3 && (
                    <span className="text-xs text-muted-foreground">
                      +{article.tags.length - 3}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {article.viewCount}
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground">
                {format(new Date(article.updatedAt), 'MMM d, HH:mm')}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(article)}
                    title="編輯"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  {article.status !== 'PUBLISHED' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPublish(article.id)}
                      title="發布"
                    >
                      <Globe className="h-4 w-4" />
                    </Button>
                  )}
                  {article.status !== 'ARCHIVED' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onArchive(article.id)}
                      title="封存"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(article.id)}
                    title="刪除"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
