'use client';

import React, { useState, useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Upload, Search, Loader2, Brain, ThumbsDown, Check, Pencil } from 'lucide-react';
import { useKnowledge, useCategories, useSources } from '@/hooks/useKnowledge';
import { useKbFeedbackList, resolveKbFeedback } from '@/hooks/useKbFeedback';
import { ArticleList } from '@/components/knowledge/ArticleList';
import { Chip } from '@/components/ui/chip';
import { AddIcon, KnowledgeArticleIcon } from '@/components/icons/figma-icons';
import { ArticleFormDialog } from '@/components/knowledge/ArticleFormDialog';
import { ImportDialog } from '@/components/knowledge/ImportDialog';
import { EmbeddingSettings } from '@/components/knowledge/EmbeddingSettings';
import { ChatPromptSettings } from '@/components/knowledge/ChatPromptSettings';
import { Topbar } from '@/components/layout/Topbar';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent } from '@/components/ui/tabs';
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const section = pathname.split('/').at(-1);
  const legacyTab = searchParams.get('tab');
  const pageTab = section === 'search' || legacyTab === 'search'
    ? 'search'
    : section === 'feedback' || legacyTab === 'feedback'
      ? 'feedback'
      : section === 'embedding' || legacyTab === 'embedding'
        ? 'embedding'
        : section === 'chat-prompt' || legacyTab === 'chat'
          ? 'chat'
          : 'articles';

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
      {/* 說明文字：Figma 6.1.1 的說明是從人員管理頁複製來的佔位文字，這裡改成知識庫的說明 */}
      <Topbar
        title={pageTab === 'chat' ? 'Chat & Prompt' : pageTab === 'embedding' ? 'Embedding 設定' : pageTab === 'search' ? '語義搜尋' : pageTab === 'feedback' ? '回報調教' : '文章管理'}
        description={{
          articles: '管理 AI 回覆時參考的知識文章，發布後才會被搜尋到',
          search: '輸入關鍵字進行語義搜尋，系統會根據向量相似度找到最相關的知識庫文章',
          feedback: '使用者在 LINE 點「👎 沒幫到我」的回報。點「編輯文章」修正知識庫內容（存檔後自動重新嵌入），處理完點「標為已處理」',
          embedding: '設定知識庫向量化所使用的 Ollama 服務、模型，以及語意搜尋的 topK 與相似度門檻',
          chat: '設定 KB 自動回覆與對話摘要使用的 LLM 提供者、模型、生成參數，以及系統提示詞',
        }[pageTab]}
      >
        {pageTab === 'articles' && (
          <>
            <Button variant="outline" size="lg" className="w-[140px]" onClick={() => setImportOpen(true)}>
              <Upload />
              匯入文章
            </Button>
            <Button size="lg" className="w-[140px]" onClick={handleNewArticle}>
              <AddIcon />
              新增文章
            </Button>
          </>
        )}
      </Topbar>

      {/* Top-level page tabs: articles vs semantic search */}
      <div className="flex-1 overflow-hidden px-8">
        <Tabs value={pageTab} onValueChange={() => undefined}>

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
            className="mt-0 flex h-[calc(100vh-51px-160px)] flex-col pb-6"
          >
            {/* 篩選列依 Figma：狀態膠囊（Chip / Filter Large）＋分類、來源下拉＋搜尋，間距 16 */}
            <div className="flex shrink-0 flex-wrap items-center gap-4 pb-5">
              <div role="group" aria-label="文章狀態" className="flex flex-wrap items-center gap-4">
                {statusTabs.map((tab) => (
                  <Chip
                    key={tab.value}
                    size="lg"
                    tone={statusFilter === tab.value ? 'primary' : 'default'}
                    selected={statusFilter === tab.value}
                    onClick={() => setStatusFilter(tab.value)}
                  >
                    {tab.label}
                  </Chip>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-4">
                {categories.length > 0 && (
                  <Select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    options={categoryOptions}
                    aria-label="分類"
                    className="w-[180px]"
                  />
                )}
                {sources.length > 0 && (
                  <Select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    options={sourceOptions}
                    aria-label="來源"
                    className="w-[180px]"
                  />
                )}
                <SearchInput placeholder="搜尋文章" onSearch={setSearch} className="w-[210px]" />
              </div>
              {tagFilter && (
                <Chip size="lg" tone="outline" onClick={() => setTagFilter('')} title="點擊清除標籤篩選">
                  標籤：{tagFilter} ✕
                </Chip>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
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

            {articles.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-7 pl-3 pt-5">
                <span className="text-base font-medium text-muted-foreground">
                  顯示 {(page - 1) * PAGE_SIZE + 1}-{(page - 1) * PAGE_SIZE + articles.length} 篇，共 {total} 篇
                </span>
                {totalPages > 1 && (
                  <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                )}
              </div>
            )}
          </TabsContent>

          {/* ── Semantic Search Tab ───────────────────────────── */}
          <TabsContent value="search" className="mt-0">
            {/* 版面依 Figma 6.2.1／6.2.2 語意搜尋：搜尋框＋搜尋按鈕，結果為「標題｜匹配度」列表 */}
            <div className="flex flex-col gap-7 pb-8">
              <div className="flex max-w-[646px] items-center gap-4">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
                  <Input
                    placeholder="輸入查詢文字，例：冰箱不冷怎麼辦"
                    aria-label="查詢文字"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearch()}
                    className="h-11 bg-muted pl-10"
                  />
                </div>
                <Button size="lg" className="w-[98px]" onClick={handleSemanticSearch} disabled={searching || !searchQuery.trim()} loading={searching}>
                  搜尋
                </Button>
              </div>

              {searchError && (
                <div role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-destructive">
                  {searchError}
                </div>
              )}

              {searchResults.length > 0 && (
                <div role="table" aria-label="搜尋結果" className="overflow-hidden rounded-lg border border-border">
                  <div role="row" className="flex items-center gap-4 border-b border-border bg-muted px-5 py-2 text-sm font-medium leading-7 text-muted-foreground">
                    <span role="columnheader" className="flex-1">標題</span>
                    <span role="columnheader" className="w-[122px]">匹配度</span>
                  </div>
                  {searchResults.map((r: any) => (
                    <div key={r.id} role="row" className="flex items-start gap-4 border-b border-border bg-background px-5 py-4 last:border-b-0">
                      <span role="cell" className="flex min-w-0 flex-1 items-start gap-3">
                        <KnowledgeArticleIcon className="h-5 w-5 flex-none" />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold text-foreground">{r.title}</span>
                          {r.summary && <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">{r.summary}</span>}
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            {r.category && <Badge variant="outline">{r.category}</Badge>}
                            {r.tags?.slice(0, 3).map((tag: string) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                          </span>
                        </span>
                      </span>
                      <span role="cell" className="w-[122px]">
                        {/* Figma「Tag / Custom」實心膠囊 */}
                        <span className="inline-flex h-6 items-center rounded-full bg-primary px-4 text-xs font-medium tabular-nums text-white">
                          {(r.similarity * 100).toFixed(1)}% 匹配
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {!searching && searchResults.length === 0 && searchQuery && (
                <p className="py-8 text-center text-sm text-muted-foreground">沒有找到相關文章，請嘗試不同的查詢詞</p>
              )}
            </div>
          </TabsContent>

          {/* ── 回報調教 Tab ──────────────────────────────────── */}
          <TabsContent value="feedback" className="mt-0 flex flex-col pb-8">
            {/* 說明文字移到頁面標題列 */}
            <div>
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
                    <div key={f.id} className="rounded-lg border border-border bg-background p-4">
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
          <TabsContent value="embedding" className="mt-0">
            <div className="pb-8">
              <EmbeddingSettings />
            </div>
          </TabsContent>

          {/* ── Chat & Prompt Settings Tab ────────────────────── */}
          <TabsContent value="chat" className="mt-0">
            <div className="pb-8">
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
