'use client';

import React, { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useActivities } from '@/hooks/usePortal';
import { ActivityFormDialog } from '@/components/portal/ActivityFormDialog';
import { SubmissionsView } from '@/components/portal/SubmissionsView';
import { PointsTab } from '@/components/portal/PointsTab';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { AddIcon } from '@/components/icons/figma-icons';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';

interface ActivityItem {
  id: string;
  type: string;
  status: string;
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  settings?: Record<string, unknown>;
  options?: unknown[];
  fields?: unknown[];
  _count?: { submissions: number };
}

// 類型：Claude Design 稿是投票／抽獎／問答／簽到，系統實際支援的是投票／表單／競猜，以系統為準
const TYPE_LABEL: Record<string, string> = { POLL: '投票', FORM: '表單', QUIZ: '競猜' };
const TYPES = ['ALL', 'POLL', 'FORM', 'QUIZ'] as const;

const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '進行中', ENDED: '已結束', ARCHIVED: '已封存' };
// 狀態標籤顏色依 Claude Design（進行中＝綠框淡綠底、已結束＝灰），換成 Figma Tag 的樣式
const STATUS_VARIANT: Record<string, 'outline-success' | 'outline' | 'secondary' | 'warning'> = {
  PUBLISHED: 'outline-success',
  DRAFT: 'warning',
  ENDED: 'outline',
  ARCHIVED: 'secondary',
};
const STATUS_TABS = ['ALL', 'PUBLISHED', 'DRAFT', 'ENDED', 'ARCHIVED'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('zh-TW') : '');

interface ActivityListProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

// 版面依 Claude Design「活動管理」：狀態分頁（附數量）＋類型膠囊、卡片排列、底部統計
function ActivityList({ dialogOpen, setDialogOpen }: ActivityListProps) {
  const router = useRouter();
  const [statusTab, setStatusTab] = useState<StatusTab>('ALL');
  const [typeFilter, setTypeFilter] = useState<(typeof TYPES)[number]>('ALL');
  // 封存的活動後端預設不回傳，要另外查（unarchive 才有入口）
  const showArchived = statusTab === 'ARCHIVED';
  const { activities, isLoading, mutate } = useActivities(showArchived ? { status: 'ARCHIVED' } : undefined);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const all = activities as ActivityItem[];
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: all.length };
    for (const a of all) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [all]);
  const visible = all.filter(
    (a) => (showArchived || statusTab === 'ALL' || a.status === statusTab) && (typeFilter === 'ALL' || a.type === typeFilter),
  );
  const filtered = visible.length !== all.length;

  const run = async (id: string, action: () => Promise<unknown>, fallback: string) => {
    setActioning(id);
    try {
      await action();
      mutate();
    } catch (err) {
      console.error(fallback, err);
      alert(getApiErrorMessage(err, fallback));
    } finally {
      setActioning(null);
    }
  };

  const handlePublish = (id: string) => run(id, () => api.post(`/portal/activities/${id}/publish`), '發布失敗，請稍後重試');
  const handleEnd = (id: string) => {
    if (!confirm('提前結束後，前台將無法再參加此活動。確定結束？')) return;
    run(id, () => api.post(`/portal/activities/${id}/end`), '結束活動失敗，請稍後重試');
  };
  // 封存而非刪除：PortalSubmission 對活動是 Cascade，硬刪會連帶清掉參與者的提交紀錄與積分依據
  const handleArchive = (id: string) => {
    if (!confirm('封存後此活動不再顯示於列表，參與紀錄仍會保留。確定封存？')) return;
    run(id, () => api.post(`/portal/activities/${id}/archive`), '封存失敗，請稍後重試');
  };
  const handleUnarchive = (id: string) => run(id, () => api.post(`/portal/activities/${id}/unarchive`), '取消封存失敗，請稍後重試');
  const handleDelete = (id: string) => {
    if (!confirm('確定刪除此活動？')) return;
    run(id, () => api.delete(`/portal/activities/${id}`), '刪除失敗，請稍後重試');
  };
  const openEdit = (a: ActivityItem) => { setEditData(a as unknown as Record<string, unknown>); setDialogOpen(true); };

  return (
    <div className="flex flex-col gap-5">
      {/* 篩選列：左邊狀態分頁（Segmented），右邊類型膠囊；依 Figma 微調 */}
      <div className="flex flex-wrap items-center gap-4">
        <div role="tablist" aria-label="活動狀態" className="flex h-10 items-center gap-1 rounded-md bg-muted p-1">
          {STATUS_TABS.map((s) => {
            const on = statusTab === s;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatusTab(s)}
                className={`flex h-8 items-center gap-1.5 rounded-md px-4 text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  on ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'ALL' ? '全部狀態' : STATUS_LABEL[s]}
                {/* 已封存的活動要另外查，所以兩邊的數量不會同時有：在封存分頁只顯示封存數，其他分頁不顯示封存數 */}
                {(showArchived ? s === 'ARCHIVED' : s !== 'ARCHIVED') && (
                  <span className="text-xs tabular-nums text-muted-foreground">{counts[s] ?? 0}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {TYPES.map((t) => (
            <Chip
              key={t}
              size="lg"
              tone={typeFilter === t ? 'primary' : 'outline'}
              selected={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'ALL' ? '全部類型' : TYPE_LABEL[t]}
            </Chip>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {all.length === 0 && !showArchived ? '還沒有活動，點右上角「新增活動」開始' : '此條件下沒有活動，換個狀態或類型看看'}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
          {visible.map((a) => {
            const count = a._count?.submissions ?? 0;
            const busy = actioning === a.id;
            return (
              <div
                key={a.id}
                className={`flex flex-col gap-4 rounded-lg border border-border bg-background p-5 ${a.status === 'ENDED' || a.status === 'ARCHIVED' ? 'opacity-80' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="info">{TYPE_LABEL[a.type] ?? a.type}</Badge>
                  <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{STATUS_LABEL[a.status] ?? a.status}</Badge>
                </div>

                <div className="flex flex-col gap-1">
                  <h3 className="line-clamp-1 text-base font-semibold leading-6 text-foreground" title={a.title}>{a.title}</h3>
                  <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{a.description || '—'}</p>
                </div>

                <div className="flex items-stretch gap-4 rounded-md bg-muted px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">參加人數</span>
                    <span className="text-base font-semibold tabular-nums text-foreground">
                      {count.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">人</span>
                    </span>
                  </div>
                  <div className="w-px bg-border" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">活動期間</span>
                    <span className="truncate text-sm font-medium tabular-nums text-foreground">
                      {a.startsAt || a.endsAt ? `${fmtDate(a.startsAt)} ~ ${fmtDate(a.endsAt)}` : '尚未設定期間'}
                    </span>
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="處理中" />}
                  {a.status === 'DRAFT' && (
                    <>
                      <Button size="xs" onClick={() => handlePublish(a.id)} disabled={busy}>發布</Button>
                      <Button size="xs" variant="ghost" onClick={() => openEdit(a)}>編輯</Button>
                      <Button size="xs" variant="ghost" className="text-destructive" onClick={() => handleDelete(a.id)}>刪除</Button>
                    </>
                  )}
                  {a.status === 'PUBLISHED' && (
                    <>
                      <Button size="xs" onClick={() => router.push('/dashboard/portal/submissions')}>查看參與紀錄</Button>
                      <Button size="xs" variant="ghost" onClick={() => handleEnd(a.id)} disabled={busy}>提前結束</Button>
                    </>
                  )}
                  {a.status === 'ENDED' && (
                    <>
                      <Button size="xs" onClick={() => router.push('/dashboard/portal/submissions')}>查看參與紀錄</Button>
                      <Button size="xs" variant="ghost" onClick={() => handleArchive(a.id)} disabled={busy}>封存</Button>
                    </>
                  )}
                  {a.status === 'ARCHIVED' && (
                    <Button size="xs" variant="ghost" onClick={() => handleUnarchive(a.id)} disabled={busy}>取消封存</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && all.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>共 {visible.length} 個活動{filtered ? `（篩選自 ${all.length} 個）` : ''}</span>
          {!showArchived && (
            <span>進行中 {counts.PUBLISHED ?? 0} · 草稿 {counts.DRAFT ?? 0} · 已結束 {counts.ENDED ?? 0}</span>
          )}
        </div>
      )}

      <ActivityFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditData(null); }}
        onSaved={() => mutate()}
        editData={editData}
      />
    </div>
  );
}

export default function PortalPage() {
  const section = usePathname().split('/').at(-1);
  const tab = section === 'submissions' || section === 'points' ? section : 'activities';
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <Topbar
        title="粉絲活動"
        description={tab === 'activities' ? '建立與追蹤投票、表單與競猜活動，草稿完成設定後即可發布至前台' : undefined}
      >
        {tab === 'activities' && (
          <Button size="lg" className="w-[140px]" onClick={() => setDialogOpen(true)}>
            <AddIcon />
            新增活動
          </Button>
        )}
      </Topbar>
      <div className="flex-1 overflow-auto px-8 pb-8">
        <Tabs value={tab} onValueChange={() => undefined}>
          <TabsContent value="activities" className="mt-0">
            <ActivityList dialogOpen={dialogOpen} setDialogOpen={setDialogOpen} />
          </TabsContent>
          <TabsContent value="submissions" className="mt-0">
            <SubmissionsView />
          </TabsContent>
          <TabsContent value="points" className="mt-0">
            <PointsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
