'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Plus, Play, Square, Loader2, Users, Archive } from 'lucide-react';
import { useActivities } from '@/hooks/usePortal';
import { ActivityFormDialog } from '@/components/portal/ActivityFormDialog';
import { SubmissionsView } from '@/components/portal/SubmissionsView';
import { PointsTab } from '@/components/portal/PointsTab';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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

const typeMap: Record<string, { label: string; color: string }> = {
  POLL: { label: '投票', color: '#3b82f6' },
  FORM: { label: '表單', color: '#8b5cf6' },
  QUIZ: { label: '競猜', color: '#f59e0b' },
};

const statusMap: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '草稿', color: '#94a3b8' },
  PUBLISHED: { label: '進行中', color: '#22c55e' },
  ENDED: { label: '已結束', color: '#6b7280' },
  ARCHIVED: { label: '已封存', color: '#94a3b8' },
};

function ActivityList() {
  // 封存的活動預設不顯示（後端 listActivities 會排除 ARCHIVED）。
  // 沒有這個切換的話，封存等於單向操作——unarchiveActivity 端點存在卻無路徑可達。
  const [showArchived, setShowArchived] = useState(false);
  const { activities, isLoading, mutate } = useActivities(
    showArchived ? { status: 'ARCHIVED' } : undefined,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const handlePublish = async (id: string) => {
    setActioning(id);
    try {
      await api.post(`/portal/activities/${id}/publish`);
      mutate();
    } catch (err) {
      console.error('Publish error:', err);
      alert(getApiErrorMessage(err, '發布失敗，請稍後重試'));
    } finally {
      setActioning(null);
    }
  };

  const handleEnd = async (id: string) => {
    setActioning(id);
    try {
      await api.post(`/portal/activities/${id}/end`);
      mutate();
    } catch (err) {
      console.error('End error:', err);
      alert(getApiErrorMessage(err, '結束活動失敗，請稍後重試'));
    } finally {
      setActioning(null);
    }
  };

  const handleArchive = async (id: string) => {
    // 封存而非刪除：PortalSubmission 對活動是 Cascade，
    // 硬刪會連帶清掉參與者的提交紀錄與積分依據。
    if (!confirm('封存後此活動不再顯示於列表，參與紀錄仍會保留。確定封存？')) return;
    setActioning(id);
    try {
      await api.post(`/portal/activities/${id}/archive`);
      mutate();
    } catch (err) {
      console.error('Archive error:', err);
      alert(getApiErrorMessage(err, '封存失敗，請稍後重試'));
    } finally {
      setActioning(null);
    }
  };

  const handleUnarchive = async (id: string) => {
    setActioning(id);
    try {
      await api.post(`/portal/activities/${id}/unarchive`);
      mutate();
    } catch (err) {
      console.error('Unarchive error:', err);
      alert(getApiErrorMessage(err, '取消封存失敗，請稍後重試'));
    } finally {
      setActioning(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除此活動？')) return;
    try {
      await api.delete(`/portal/activities/${id}`);
      mutate();
    } catch (err) {
      console.error('Delete error:', err);
      alert(getApiErrorMessage(err, '刪除失敗，請稍後重試'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant={showArchived ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive className="h-4 w-4 mr-1" />
          {showArchived ? '返回活動列表' : '查看已封存'}
        </Button>
        <Button onClick={() => { setEditData(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> 建立活動
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(activities as ActivityItem[]).map((a) => {
            const type = typeMap[a.type] || { label: a.type, color: '#6b7280' };
            const status = statusMap[a.status] || { label: a.status, color: '#6b7280' };
            const count = a._count?.submissions ?? 0;

            return (
              <Card key={a.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge color={type.color}>{type.label}</Badge>
                    <Badge color={status.color}>{status.label}</Badge>
                  </div>

                  <h3 className="font-medium">{a.title}</h3>
                  {a.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">{a.description}</p>
                  ) : null}

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span>{count} 人參加</span>
                  </div>

                  {(a.startsAt || a.endsAt) ? (
                    <p className="text-xs text-muted-foreground">
                      {a.startsAt && new Date(a.startsAt).toLocaleDateString('zh-TW')}
                      {a.startsAt && a.endsAt && ' ~ '}
                      {a.endsAt && new Date(a.endsAt).toLocaleDateString('zh-TW')}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-2 pt-2 border-t">
                    {a.status === 'DRAFT' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handlePublish(a.id)} disabled={actioning === a.id}>
                          {actioning === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                          發布
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditData(a as unknown as Record<string, unknown>); setDialogOpen(true); }}>
                          編輯
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(a.id)}>
                          刪除
                        </Button>
                      </>
                    )}
                    {a.status === 'PUBLISHED' && (
                      <Button size="sm" variant="outline" onClick={() => handleEnd(a.id)} disabled={actioning === a.id}>
                        {actioning === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3 mr-1" />}
                        結束
                      </Button>
                    )}
                    {a.status === 'ARCHIVED' && (
                      <Button size="sm" variant="outline" onClick={() => handleUnarchive(a.id)} disabled={actioning === a.id}>
                        {actioning === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3 mr-1" />}
                        取消封存
                      </Button>
                    )}
                    {a.status === 'ENDED' && (
                      // 已結束的活動原本沒有任何操作，會永遠留在列表上
                      <Button size="sm" variant="ghost" onClick={() => handleArchive(a.id)} disabled={actioning === a.id}>
                        {actioning === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3 mr-1" />}
                        封存
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {activities.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              尚無活動，點擊「建立活動」開始
            </div>
          )}
        </div>
      )}

      <ActivityFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => mutate()}
        editData={editData}
      />
    </div>
  );
}

export default function PortalPage() {
  const section = usePathname().split('/').at(-1);
  const tab = section === 'submissions' || section === 'points' ? section : 'activities';

  return (
    <div className="flex flex-1 flex-col">
      <Topbar title="粉絲活動" />
      <div className="flex-1 overflow-auto p-6">
        <Tabs value={tab} onValueChange={() => undefined}>

          <TabsContent value="activities" className="mt-4">
            <ActivityList />
          </TabsContent>

          <TabsContent value="submissions" className="mt-4">
            <SubmissionsView />
          </TabsContent>

          <TabsContent value="points" className="mt-4">
            <PointsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
