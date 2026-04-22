'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Play,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useCampaign, useBroadcasts } from '@/hooks/useMarketing';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

const campaignStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  active: { label: '進行中', color: '#22c55e' },
  completed: { label: '已完成', color: '#3b82f6' },
  cancelled: { label: '已取消', color: '#ef4444' },
};

const broadcastStatusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  scheduled: { label: '已排程', color: '#f59e0b' },
  sending: { label: '發送中', color: '#3b82f6' },
  completed: { label: '已完成', color: '#22c55e' },
  failed: { label: '失敗', color: '#ef4444' },
  cancelled: { label: '已取消', color: '#94a3b8' },
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.campaignId as string;
  const { campaign, isLoading, mutate } = useCampaign(campaignId);
  useBroadcasts(campaignId); // Keep mounted for cache

  const handleStatusChange = async (newStatus: string) => {
    const labels: Record<string, string> = {
      active: '啟動',
      completed: '完成',
      cancelled: '取消',
    };
    if (!confirm(`確定要${labels[newStatus] || newStatus}此活動嗎？`)) { return; }
    try {
      await api.patch(`/marketing/campaigns/${campaignId}`, { status: newStatus });
      mutate();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '操作失敗');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">找不到該行銷活動</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/marketing')}>
          返回行銷
        </Button>
      </div>
    );
  }

  const statusInfo = campaignStatusMap[campaign.status] || {
    label: campaign.status,
    color: '#6b7280',
  };
  const metrics = campaign.metrics || {};

  return (
    <div className="flex h-full flex-col">
      <Topbar title="行銷活動詳情" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          {/* Header */}
          <div className="mb-6">
            <Button
              variant="ghost"
              size="sm"
              className="mb-4"
              onClick={() => router.push('/dashboard/marketing')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回行銷
            </Button>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold">{campaign.name}</h2>
                  <Badge color={statusInfo.color}>{statusInfo.label}</Badge>
                </div>
                {campaign.description && (
                  <p className="mt-1 text-muted-foreground">{campaign.description}</p>
                )}
                <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
                  {campaign.startDate && (
                    <span>
                      開始：{new Date(campaign.startDate).toLocaleDateString('zh-TW')}
                    </span>
                  )}
                  {campaign.endDate && (
                    <span>
                      結束：{new Date(campaign.endDate).toLocaleDateString('zh-TW')}
                    </span>
                  )}
                  <span>
                    建立：{new Date(campaign.createdAt).toLocaleDateString('zh-TW')}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {campaign.status === 'draft' && (
                  <Button onClick={() => handleStatusChange('active')}>
                    <Play className="mr-2 h-4 w-4" />
                    啟動
                  </Button>
                )}
                {campaign.status === 'active' && (
                  <>
                    <Button onClick={() => handleStatusChange('completed')}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      完成
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleStatusChange('cancelled')}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      取消
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Metrics Cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold">{metrics.totalSent ?? 0}</p>
              <p className="text-sm text-muted-foreground">總發送</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold text-green-600">{metrics.delivered ?? 0}</p>
              <p className="text-sm text-muted-foreground">成功送達</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold text-red-600">{metrics.failed ?? 0}</p>
              <p className="text-sm text-muted-foreground">失敗</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold text-blue-600">{metrics.deliveryRate ?? 0}%</p>
              <p className="text-sm text-muted-foreground">送達率</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold text-purple-600">{metrics.replied ?? 0}</p>
              <p className="text-sm text-muted-foreground">
                回覆 {metrics.replyRate ? `(${metrics.replyRate}%)` : ''}
              </p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-3xl font-bold text-orange-600">{metrics.casesOpened ?? 0}</p>
              <p className="text-sm text-muted-foreground">引發開案</p>
            </div>
          </div>

          {/* Broadcasts List */}
          <div>
            <h3 className="mb-4 text-lg font-semibold">
              廣播記錄 ({campaign.broadcasts?.length || 0})
            </h3>

            {(campaign.broadcasts || []).length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                此活動尚無廣播記錄
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">名稱</th>
                      <th className="pb-2 font-medium">狀態</th>
                      <th className="pb-2 font-medium">受眾</th>
                      <th className="pb-2 font-medium">發送</th>
                      <th className="pb-2 font-medium">成功</th>
                      <th className="pb-2 font-medium">失敗</th>
                      <th className="pb-2 font-medium">時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaign.broadcasts.map((b: any) => {
                      const bStatus = broadcastStatusMap[b.status] || {
                        label: b.status,
                        color: '#6b7280',
                      };
                      return (
                        <tr key={b.id} className="border-b">
                          <td className="py-3 font-medium">{b.name}</td>
                          <td className="py-3">
                            <Badge color={bStatus.color}>{bStatus.label}</Badge>
                          </td>
                          <td className="py-3 text-muted-foreground">
                            {b.targetType === 'all'
                              ? '全部'
                              : b.targetType === 'segment'
                                ? '分群'
                                : b.targetType}
                          </td>
                          <td className="py-3">{b.totalCount}</td>
                          <td className="py-3 text-green-600">{b.successCount}</td>
                          <td className="py-3 text-red-600">{b.failedCount}</td>
                          <td className="py-3 text-muted-foreground">
                            {b.sentAt
                              ? new Date(b.sentAt).toLocaleString('zh-TW')
                              : b.scheduledAt
                                ? `排程: ${new Date(b.scheduledAt).toLocaleString('zh-TW')}`
                                : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
