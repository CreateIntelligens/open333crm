'use client';

/**
 * RichMenuBindDialog — 把已發布的 Rich Menu 綁定給某受眾分群
 *
 * 選一個 Segment → 送出，後端解析出該群 LINE uid 並背景批次綁定。
 * 對齊 rich-menu-audience-targeting：不同受眾看不同 menu。
 */

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import { useSegments } from '@/hooks/useMarketing';
import { bindRichMenuAudience } from '@/hooks/useRichMenus';

interface Segment { id: string; name: string; count?: number }

interface Props {
  richMenuId: string;
  richMenuName: string;
  onClose: () => void;
}

export function RichMenuBindDialog({ richMenuId, richMenuName, onClose }: Props) {
  const { segments } = useSegments() as { segments: Segment[] };
  const [segmentId, setSegmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBind = async () => {
    if (!segmentId) return;
    setBusy(true);
    setError(null);
    try {
      const { queued } = await bindRichMenuAudience(richMenuId, { segmentId });
      setResult(
        queued > 0
          ? `已送出綁定給 ${queued} 位有 LINE 身分的使用者（背景執行中）。`
          : '此分群沒有可綁定的 LINE 使用者。',
      );
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          '綁定失敗，請重試',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />綁定受眾 · {richMenuName}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <p className="rounded-md bg-success-subtle px-3 py-2.5 text-sm text-success">{result}</p>
            <div className="flex justify-end">
              <Button onClick={onClose}>完成</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              選一個受眾分群，這個圖文選單就只會顯示給該分群中有 LINE 身分的使用者（其他人維持原本的預設選單）。
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">受眾分群</label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-sm text-foreground dark:bg-card"
              >
                <option value="">請選擇分群…</option>
                {segments?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{typeof s.count === 'number' ? `（${s.count} 人）` : ''}
                  </option>
                ))}
              </select>
              {(!segments || segments.length === 0) && (
                <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                  尚無受眾分群，請先到「行銷 › 受眾分群」建立。
                </p>
              )}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button onClick={handleBind} disabled={busy || !segmentId}>
                {busy ? '綁定中…' : '綁定'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
