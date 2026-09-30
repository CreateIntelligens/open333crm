'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { usePermission } from '@/providers/AuthProvider';

interface MergeLog {
  id: string;
  survivorId: string;
  mergedId: string;
  source: string;
  createdAt: string;
  revertedAt: string | null;
  revertedBy: string | null;
  movedRecords: { channelIdentity?: string[]; conversation?: string[] };
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '手動合併',
  SUGGESTION: '合併建議',
  LINE_LOGIN: 'LINE Login',
  FB_LOGIN: 'Facebook Login',
  BINDING_CODE: '跨渠道綁定',
};

/**
 * 聯絡人的合併紀錄（作為合併後的聯絡人、或曾被併入別人），可逐筆解除。
 * 對應 API：GET /contacts/:id/merge-logs、POST /contacts/merge-logs/:logId/revert
 */
export function ContactMergeHistory({ contactId, onUpdate }: { contactId: string; onUpdate: () => void }) {
  const canMerge = usePermission('contact.merge');
  const [logs, setLogs] = useState<MergeLog[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get(`/contacts/${contactId}/merge-logs`);
      setLogs(res.data.data as MergeLog[]);
    } catch (err) {
      setLoadError(getApiErrorMessage(err, '讀取合併紀錄失敗'));
    }
  }, [contactId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleRevert = async (logId: string) => {
    setRevertingId(logId);
    setError(null);
    try {
      await api.post(`/contacts/merge-logs/${logId}/revert`);
      setConfirmingId(null);
      await fetchLogs();
      onUpdate();
    } catch (err) {
      setError(getApiErrorMessage(err, '解除合併失敗，請稍後重試'));
    } finally {
      setRevertingId(null);
    }
  };

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }
  if (!logs) {
    return <p className="text-sm text-muted-foreground">載入中...</p>;
  }
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">沒有合併紀錄</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => {
        const isSurvivor = log.survivorId === contactId;
        const otherId = isSurvivor ? log.mergedId : log.survivorId;
        const identities = log.movedRecords?.channelIdentity?.length ?? 0;
        return (
          <div key={log.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{SOURCE_LABEL[log.source] ?? log.source}</Badge>
              {log.revertedAt && <Badge variant="outline">已解除</Badge>}
              <span className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString('zh-TW')}</span>
            </div>
            <p className="text-sm">
              {isSurvivor ? '併入了' : '已被併入'}{' '}
              <Link href={`/dashboard/contacts/${otherId}`} className="text-primary underline-offset-2 hover:underline">
                另一位聯絡人
              </Link>
              {isSurvivor && identities > 0 && `（帶入 ${identities} 個渠道帳號）`}
            </p>
            {log.revertedAt && (
              <p className="text-xs text-muted-foreground">
                {new Date(log.revertedAt).toLocaleString('zh-TW')} 由{log.revertedBy === 'customer' ? '顧客自行' : '客服'}解除
              </p>
            )}
            {!log.revertedAt && canMerge && (
              <div className="flex flex-wrap items-center gap-2">
                {confirmingId === log.id ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      解除後被合併的聯絡人會恢復，並搬回當時的渠道帳號與對話；標籤與自訂屬性不會搬回。
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleRevert(log.id)}
                      disabled={revertingId === log.id}
                    >
                      {revertingId === log.id ? '解除中...' : '確定解除'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmingId(null)}>
                      取消
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmingId(log.id)}>
                    解除合併
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
    </div>
  );
}
