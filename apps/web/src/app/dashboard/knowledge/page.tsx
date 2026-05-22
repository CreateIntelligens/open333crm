'use client';

import React, { useState, useCallback } from 'react';
import { Plus, Upload, Search, Loader2, Brain } from 'lucide-react';
import { useKnowledge, useCategories } from '@/hooks/useKnowledge';
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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pageTab, setPageTab] = useState<'articles' | 'search' | 'embedding' | 'chat'>('articles');

  // Semantic search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const { articles, meta, isLoading, mutate } = useKnowledge({
    status: statusFilter === 'all' ? undefined : statusFilter,
    category: categoryFilter || undefined,
    q: search || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const totalPages = meta?.totalPages ?? 1;
  const total = meta?.total ?? articles.length;

  // Reset to page 1 whenever filters change
  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, categoryFilter, search]);

  const { categories } = useCategories();

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
  }, [mutate]);

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

  return (
    <div className="flex h-full flex-col">
      <Topbar title="知識庫" />

      {/* Top-level page tabs: articles vs semantic search */}
      <div className="border-b px-6 pt-2">
        <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as 'articles' | 'search' | 'embedding' | 'chat')}>
          <TabsList>
            <TabsTrigger value="articles">文章管理</TabsTrigger>
            <TabsTrigger value="search">語義搜尋</TabsTrigger>
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
                        <Brain className="h-4 w-4 text-green-500" />
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
