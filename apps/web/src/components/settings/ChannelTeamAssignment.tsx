'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

/** 渠道↔團隊指派存取層級（對應後端 accessLevel）。 */
type AccessLevel = 'full' | 'reply_only' | 'read_only';

/** 後端 GET /channels/:id/teams 回傳的每筆指派。 */
interface ChannelTeamRow {
  channelId: string;
  teamId: string;
  accessLevel: AccessLevel;
  grantedAt?: string;
  grantedById?: string | null;
}

/** 存取層級的中文標籤與說明。 */
const ACCESS_LEVEL_OPTIONS: Array<{ value: AccessLevel; label: string }> = [
  { value: 'full', label: '可見（可回覆與操作）' },
  { value: 'reply_only', label: '可回覆' },
  { value: 'read_only', label: '唯讀' },
];

const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  full: '可見',
  reply_only: '可回覆',
  read_only: '唯讀',
};

interface ChannelTeamAssignmentProps {
  /** 目前編輯中的渠道 id。 */
  channelId: string;
}

/**
 * 渠道設定內的「指派團隊」區塊（CM-173）。
 *
 * 讓管理者把此渠道指派給一個或多個團隊，並選擇各團隊的存取層級。
 * 團隊清單目前沒有專屬 API，改從 GET /agents 的成員團隊關聯彙整出租戶所有團隊。
 * 指派/撤銷即時呼叫後端（不與外層渠道表單的儲存綁定，因為 assign_team 是獨立權限與端點）。
 */
export function ChannelTeamAssignment({ channelId }: ChannelTeamAssignmentProps) {
  // 租戶內所有團隊（id → name），來源為 GET /agents 的成員團隊關聯彙整
  const [allTeams, setAllTeams] = useState<Array<{ id: string; name: string }>>([]);
  // 此渠道目前已指派的團隊
  const [assignments, setAssignments] = useState<ChannelTeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 新增指派的暫存表單值
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<AccessLevel>('full');
  const [saving, setSaving] = useState(false);
  // 正在撤銷的 teamId（顯示 spinner 用）
  const [removingTeamId, setRemovingTeamId] = useState<string | null>(null);

  // 載入租戶團隊清單（專用端點，含尚無成員的空團隊；名稱不會退回 raw UUID）
  const fetchTeams = useCallback(async () => {
    try {
      const res = await api.get('/channels/teams');
      const teams: Array<{ id: string; name: string }> = res.data?.data || [];
      setAllTeams(teams);
    } catch {
      // 拿不到就留空，不影響已存在的指派顯示
      setAllTeams([]);
    }
  }, []);

  // 載入此渠道目前的團隊指派
  const fetchAssignments = useCallback(async () => {
    try {
      const res = await api.get(`/channels/${channelId}/teams`);
      setAssignments((res.data?.data as ChannelTeamRow[]) || []);
    } catch {
      setAssignments([]);
    }
  }, [channelId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTeams(), fetchAssignments()]).finally(() => setLoading(false));
  }, [fetchTeams, fetchAssignments]);

  // 已指派的 teamId 集合，用來從「可新增」下拉中排除
  const assignedTeamIds = useMemo(
    () => new Set(assignments.map((a) => a.teamId)),
    [assignments],
  );

  // 尚可指派的團隊（排除已指派者）
  const availableTeams = useMemo(
    () => allTeams.filter((t) => !assignedTeamIds.has(t.id)),
    [allTeams, assignedTeamIds],
  );

  const teamNameOf = useCallback(
    (teamId: string) => allTeams.find((t) => t.id === teamId)?.name ?? teamId,
    [allTeams],
  );

  // 依 availableTeams 自動預選第一個可指派團隊
  useEffect(() => {
    if (availableTeams.length > 0 && !availableTeams.some((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(availableTeams[0].id);
    } else if (availableTeams.length === 0) {
      setSelectedTeamId('');
    }
  }, [availableTeams, selectedTeamId]);

  async function handleAdd() {
    if (!selectedTeamId) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/channels/${channelId}/teams`, {
        teamId: selectedTeamId,
        accessLevel: selectedLevel,
      });
      await fetchAssignments();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(msg || '指派失敗，請再試一次');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(teamId: string) {
    setRemovingTeamId(teamId);
    setError('');
    try {
      await api.delete(`/channels/${channelId}/teams/${teamId}`);
      await fetchAssignments();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(msg || '撤銷失敗，請再試一次');
    } finally {
      setRemovingTeamId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">指派團隊</p>
        <p className="text-xs text-muted-foreground">
          選擇哪些團隊能在收件匣看到此渠道的對話，並設定各團隊的存取層級。未指派任何團隊或成員時，此渠道維持全租戶公開（向後相容）；一旦指派，即限縮為僅授權對象（及具「總店」權限者）可見。
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          載入中…
        </div>
      ) : (
        <>
          {/* 已指派清單 */}
          {assignments.length > 0 ? (
            <div className="space-y-1.5">
              {assignments.map((a) => (
                <div
                  key={a.teamId}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{teamNameOf(a.teamId)}</span>
                    <Badge variant="secondary">{ACCESS_LEVEL_LABEL[a.accessLevel]}</Badge>
                  </div>
                  <button
                    type="button"
                    title="撤銷指派"
                    disabled={removingTeamId === a.teamId}
                    onClick={() => handleRemove(a.teamId)}
                    className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    {removingTeamId === a.teamId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              尚未指派任何團隊
            </p>
          )}

          {/* 新增指派 */}
          {availableTeams.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">團隊</label>
                <Select
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  options={availableTeams.map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">存取層級</label>
                <Select
                  value={selectedLevel}
                  onChange={(e) => setSelectedLevel(e.target.value as AccessLevel)}
                  options={ACCESS_LEVEL_OPTIONS}
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleAdd}
                disabled={saving || !selectedTeamId}
                className="shrink-0"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" />
                    新增
                  </>
                )}
              </Button>
            </div>
          ) : allTeams.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              尚未建立任何團隊，請先於「人員管理」建立團隊。
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">所有團隊都已指派。</p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
