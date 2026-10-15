'use client';

import React from 'react';
import { format } from 'date-fns';
import { Loader2, BookOpen, Globe, Archive, Brain, Paperclip } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { DeleteIcon, EditIcon, KnowledgeArticleIcon } from '@/components/icons/figma-icons';
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
  externalDocId?: string | null;
  externalVer?: number;
  externalSource?: string | null;
  _count?: { attachments: number };
}

interface ArticleListProps {
  articles: Article[];
  isLoading: boolean;
  onEdit: (article: Article) => void;
  onPublish: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onTagClick?: (tag: string) => void;
}

const statusLabel: Record<string, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已發布',
  ARCHIVED: '已封存',
};

const statusTone: Record<string, 'primary' | 'default' | 'outline'> = {
  PUBLISHED: 'primary',
  DRAFT: 'default',
  ARCHIVED: 'outline',
};

// 欄寬依 Figma 6.1.1 知識庫列表：標題彈性（Figma 500）、分類 140、狀態 80、標籤 80、瀏覽數 71、更新時間 170；
// 「操作」欄 Figma 沒有畫，保留原本的編輯／發布／封存／刪除
const COLS = 'grid grid-cols-[minmax(0,1fr)_140px_80px_80px_71px_120px_136px] items-center gap-4 px-5';

function TagPill({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  const cls = 'inline-flex max-w-full items-center truncate rounded-lg border border-border bg-muted px-2 text-[10px] leading-[15px] text-muted-foreground';
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={`${cls} hover:border-primary hover:text-primary`}>{children}</button>
  ) : (
    <span title={title} className={cls}>{children}</span>
  );
}

function IconAction({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-tertiary-foreground hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function ArticleList({
  articles,
  isLoading,
  onEdit,
  onPublish,
  onArchive,
  onDelete,
  onTagClick,
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
    <div role="table" aria-label="文章列表" className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[1040px]">
        <div role="row" className={`${COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
          <span role="columnheader">標題</span>
          <span role="columnheader">分類</span>
          <span role="columnheader">狀態</span>
          <span role="columnheader">標籤</span>
          <span role="columnheader">瀏覽數</span>
          <span role="columnheader">更新時間</span>
          <span role="columnheader">操作</span>
        </div>

        {articles.map((article) => (
          <div
            key={article.id}
            role="row"
            className={`${COLS} border-b border-border bg-background py-5 text-sm font-medium leading-5 text-muted-foreground transition-colors last:border-b-0 hover:bg-shell`}
          >
            <span role="cell" className="flex min-w-0 items-start gap-3">
              <KnowledgeArticleIcon className="h-5 w-5 flex-none" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-foreground" title={article.title}>{article.title}</span>
                {article.summary && (
                  <span className="truncate text-xs font-normal leading-5 text-muted-foreground" title={article.summary}>{article.summary}</span>
                )}
                {(article.externalSource || article.externalDocId || (article._count?.attachments ?? 0) > 0 || article.hasEmbedding) && (
                  <span className="flex flex-wrap items-center gap-2 text-xs font-normal leading-5 text-muted-foreground">
                    {article.externalSource && <TagPill>{article.externalSource}</TagPill>}
                    {article.externalDocId && (
                      <span>DocID {article.externalDocId}{article.externalVer ? ` · v${article.externalVer}` : ''}</span>
                    )}
                    {(article._count?.attachments ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-0.5" title="附件數">
                        <Paperclip className="h-3 w-3" />
                        {article._count?.attachments}
                      </span>
                    )}
                    {/* Figma 沒有畫向量化狀態，保留原有提示 */}
                    {article.hasEmbedding && (
                      <span className="inline-flex items-center gap-0.5 text-success" title="已向量化，AI 可以搜尋到這篇">
                        <Brain className="h-3 w-3" />
                        已向量化
                      </span>
                    )}
                  </span>
                )}
              </span>
            </span>

            <span role="cell" className="line-clamp-2 break-words" title={article.category}>{article.category}</span>

            <span role="cell">
              <Chip tone={statusTone[article.status] || 'default'}>{statusLabel[article.status] || article.status}</Chip>
            </span>

            <span role="cell" className="flex min-w-0 flex-col items-start gap-1">
              {article.tags.length === 0 && <span>---</span>}
              {article.tags.slice(0, 2).map((tag) => (
                <TagPill
                  key={tag}
                  onClick={onTagClick ? () => onTagClick(tag) : undefined}
                  title={onTagClick ? `篩選標籤：${tag}` : tag}
                >
                  {tag}
                </TagPill>
              ))}
              {article.tags.length > 2 && <span className="text-xs">+{article.tags.length - 2}</span>}
            </span>

            <span role="cell" className="tabular-nums">{article.viewCount}</span>

            <span role="cell" className="tabular-nums">{format(new Date(article.updatedAt), 'MMM d, HH:mm')}</span>

            <span role="cell" className="flex items-center gap-1">
              <IconAction label="編輯" onClick={() => onEdit(article)}><EditIcon className="h-4 w-4" /></IconAction>
              {article.status !== 'PUBLISHED' && (
                <IconAction label="發布" onClick={() => onPublish(article.id)}><Globe className="h-4 w-4" /></IconAction>
              )}
              {article.status !== 'ARCHIVED' && (
                <IconAction label="封存" onClick={() => onArchive(article.id)}><Archive className="h-4 w-4" /></IconAction>
              )}
              <IconAction label="刪除" onClick={() => onDelete(article.id)} className="text-destructive">
                <DeleteIcon className="h-5 w-5" />
              </IconAction>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
