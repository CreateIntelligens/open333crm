'use client';

import React, { useState, useCallback } from 'react';
import { Plus, Upload, Search, Loader2, Brain, ThumbsDown, Check, Pencil } from 'lucide-react';
import { useKnowledge, useCategories, useSources } from '@/hooks/useKnowledge';
import { useKbFeedbackList, resolveKbFeedback } from '@/hooks/useKbFeedback';
import { ArticleList } from '@/components/knowledge/ArticleList';
import { ArticleFormDialog } from '@/components/knowledge/ArticleFormDialog';
import { ImportDialog } from '@/components/knowledge/ImportDialog';
import { EmbeddingSettings } from '@/components/knowledge/EmbeddingSettings';
import { ChatPromptSettings } from '@/components/knowledge/ChatPromptSettings';
import { Topbar } from '@/components/layout/Topbar';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';

const statusTabs = [
  { value: 'all', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已發布' },
  { value: 'ARCHIVED', label: '已封存' },
];

const PAGE_SIZE = 50;

export default function KnowledgePage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pageTab, setPageTab] = useState<'articles' | 'search' | 'feedback' | 'embedding' | 'chat'>('articles');

  // KB 回報（調教）
  const { feedback, isLoading: feedbackLoading, mutate: mutateFeedback } = useKbFeedbackList({ status: 'open' });

  const handleResolveFeedback = useCallback(async (id: string) => {
    try {
      await resolveKbFeedback(id);
      mutateFeedback();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '操作失敗');
    }
  }, [mutateFeedback]);

  const handleEditFromFeedback = useCallback(async (articleId: string) => {
    try {
      const res = await api.get(`/knowledge/${articleId}`);
      setEditingArticle(res.data.data);
      setDialogOpen(true);
    } catch {
      alert('找不到此文章，可能已被刪除');
    }
  }, []);

  // Semantic search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const { articles, meta, isLoading, mutate } = useKnowledge({
    status: statusFilter === 'all' ? undefined : statusFilter,
    category: categoryFilter || undefined,
    source: sourceFilter || undefined,
    tag: tagFilter || undefined,
    q: search || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const totalPages = meta?.totalPages ?? 1;
  const total = meta?.total ?? articles.length;

  // Reset to page 1 whenever filters change
  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, categoryFilter, sourceFilter, tagFilter, search]);

  const { categories } = useCategories();
  const { sources } = useSources();

  const handleEdit = useCallback(async (article: any) => {
    try {
      const res = await api.get(`/knowledge/${article.id}`);
      setEditingArticle(res.data.data);
      setDialogOpen(true);
    } catch {
      setEditingArticle(article);
      setDialogOpen(true);
    }
  }, []);

  const handlePublish = useCallback(
    async (id: string) => {
      try {
        await api.post(`/knowledge/${id}/publish`);
        mutate();
      } catch (err: any) {
        alert(err.response?.data?.error?.message || '發布失敗');
      }
    },
    [mutate],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await api.post(`/knowledge/${id}/archive`);
        mutate();
      } catch (err: any) {
        alert(err.response?.data?.error?.message || '封存失敗');
      }
    },
    [mutate],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('確定要刪除這篇文章嗎？')) return;
      try {
        await api.delete(`/knowledge/${id}`);
        mutate();
      } catch (err: any) {
        alert(err.response?.data?.error?.message || '刪除失敗');
      }
    },
    [mutate],
  );

  const handleSaved = useCallback(() => {
    setDialogOpen(false);
    setEditingArticle(null);
    mutate();
    mutateFeedback();
  }, [mutate, mutateFeedback]);

  const handleNewArticle = useCallback(() => {
    setEditingArticle(null);
    setDialogOpen(true);
  }, []);

  const handleSemanticSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);

    try {
      const res = await api.post('/knowledge/search', { query: searchQuery.trim() });
      setSearchResults(res.data.data || []);
    } catch (err: any) {
      setSearchError(err.response?.data?.error?.message || '搜尋失敗');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const categoryOptions = [
    { value: '', label: '全部分類' },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  const sourceOptions = [
    { value: '', label: '全部來源' },
    { value: '__manual__', label: '手動建立' },
    ...sources.map((s) => ({ value: s, label: s })),
  ];

  return (
    <div className="flex h-full flex-col">
      <Topbar title="知識庫" />

      {/* Top-level page tabs: articles vs semantic search */}
      <div className="border-b px-6 pt-2">
        <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as 'articles' | 'search' | 'feedback' | 'embedding' | 'chat')}>
          <TabsList>
            <TabsTrigger value="articles">文章管理</TabsTrigger>
            <TabsTrigger value="search">語義搜尋</TabsTrigger>
            <TabsTrigger value="feedback">
              回報調教
              {feedback.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {feedback.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="embedding">Embedding 設定</TabsTrigger>
            <TabsTrigger value="chat">Chat & Prompt</TabsTrigger>
          </TabsList>

          {/* ── Articles Tab ──────────────────────────────────── */}
          {/*
            Dashboard layout uses h-screen + overflow-hidden so we must
            size this tab to the viewport explicitly (otherwise the table
            overflows and the pagination row gets clipped off-screen).
            Layout: filters / status tabs (fixed) → list (flex-1 scroll)
            → pagination (shrink-0, pinned to bottom).
          */}
          <TabsContent
            value="articles"
            className="flex h-[calc(100vh-130px)] flex-col"
          >
            <div className="border-b py-3 shrink-0">
              <div className="flex items-center gap-3">
                <SearchInput
                  placeholder="搜尋文章..."
                  onSearch={setSearch}
                  className="max-w-sm"
                />
                {categories.length > 0 && (
                  <Select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    options={categoryOptions}
                    className="w-40"
                  />
                )}
                {sources.length > 0 && (
                  <Select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    options={sourceOptions}
                    className="w-48"
                  />
                )}
                {tagFilter && (
                  <Badge
                    variant="default"
                    className="cursor-pointer gap-1"
                    onClick={() => setTagFilter('')}
                    title="點擊清除 tag 篩選"
                  >
                    Tag: {tagFilter} ✕
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                    <Upload className="mr-1.5 h-4 w-4" />
                    匯入文章
                  </Button>
                  <Button onClick={handleNewArticle}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增文章
                  </Button>
                </div>
              </div>
            </div>

            <div className="border-b pt-2 shrink-0">
              <Tabs value={statusFilter} onValueChange={setStatusFilter}>
                <TabsList>
                  {statusTabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <ArticleList
                articles={articles}
                isLoading={isLoading}
                onEdit={handleEdit}
                onPublish={handlePublish}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onTagClick={setTagFilter}
              />
            </div>
            {totalPages > 1 && (
              <div className="flex shrink-0 items-center justify-between gap-4 border-t bg-background px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  共 {total} 篇 · 第 {page} / {totalPages} 頁
                </span>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </TabsContent>

          {/* ── Semantic Search Tab ───────────────────────────── */}
          <TabsContent value="search">
            <div className="py-4">
              <div className="mb-4 flex items-center gap-3">
                <Input
                  placeholder="輸入查詢文字，例如：冰箱不冷怎麼辦..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearch()}
                  className="max-w-lg"
                />
                <Button onClick={handleSemanticSearch} disabled={searching || !searchQuery.trim()}>
                  {searching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  搜尋
                </Button>
              </div>

              {searchError && (
                <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {searchError}
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="space-y-3">
                  {searchResults.map((r: any) => (
                    <div
                      key={r.id}
                      className="rounded-lg border p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-success" />
                        <h3 className="text-sm font-medium">{r.title}</h3>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {(r.similarity * 100).toFixed(1)}% 匹配
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{r.summary}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {r.category}
                        </Badge>
                        {r.tags?.slice(0, 3).map((tag: string) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!searching && searchResults.length === 0 && searchQuery && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  沒有找到相關文章，請嘗試不同的查詢詞
                </p>
              )}

              {!searching && !searchQuery && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  輸入關鍵字進行語義搜尋，系統會根據向量相似度找到最相關的知識庫文章
                </p>
              )}
            </div>
          </TabsContent>

          {/* ── 回報調教 Tab ──────────────────────────────────── */}
          <TabsContent value="feedback" className="flex h-[calc(100vh-130px)] flex-col">
            <div className="border-b py-3 shrink-0">
              <p className="text-sm text-muted-foreground">
                使用者在 LINE 點「👎 沒幫到我」的回報。點「編輯文章」修正知識庫內容（存檔後自動重新嵌入），處理完點「標為已處理」。
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto py-2">
              {feedbackLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : feedback.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  目前沒有待處理的回報 🎉
                </p>
              ) : (
                <div className="space-y-3">
                  {feedback.map((f) => (
                    <div key={f.id} className="rounded-lg border p-4">
                      <div className="flex items-start gap-2">
                        <ThumbsDown className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {new Date(f.createdAt).toLocaleString('zh-TW')}
                            </span>
                            {f.confidence != null && (
                              <Badge variant="outline" className="text-[10px]">
                                相似度 {(f.confidence * 100).toFixed(0)}%
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1.5 text-sm">
                            <span className="font-medium text-foreground">使用者問：</span>
                            {f.userQuestion || <span className="text-muted-foreground">（無法取得問句）</span>}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            <span className="font-medium">Bot 回答：</span>
                            {f.botReply ? (f.botReply.length > 150 ? f.botReply.slice(0, 150) + '…' : f.botReply) : '—'}
                          </div>
                          <div className="mt-1.5 text-xs">
                            <span className="text-muted-foreground">命中文章：</span>
                            <span className="font-medium">{f.article?.title || f.articleId}</span>
                            {f.article?.externalDocId && (
                              <span className="ml-1 text-muted-foreground">(DocID {f.article.externalDocId})</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditFromFeedback(f.articleId)}
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            編輯文章
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResolveFeedback(f.id)}
                          >
                            <Check className="mr-1 h-3 w-3" />
                            標為已處理
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Embedding Settings Tab ────────────────────────── */}
          <TabsContent value="embedding">
            <div className="h-[calc(100vh-180px)] overflow-y-auto py-4 pr-2">
              <EmbeddingSettings />
            </div>
          </TabsContent>

          {/* ── Chat & Prompt Settings Tab ────────────────────── */}
          <TabsContent value="chat">
            <div className="h-[calc(100vh-180px)] overflow-y-auto py-4 pr-2">
              <ChatPromptSettings />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ArticleFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        article={editingArticle}
        onSaved={handleSaved}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => mutate()}
      />
    </div>
  );
}
