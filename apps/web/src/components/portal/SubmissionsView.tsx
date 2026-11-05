'use client';

import React, { useState } from 'react';
import { Award, FileText, ListFilter, Loader2 } from 'lucide-react';
import { useActivities, useSubmissions } from '@/hooks/usePortal';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';

// 版面依 Claude Design「提交紀錄」稿：活動選單＋抽獎按鈕、表格（聯繫人／提交時間／答案摘要／中獎／積分）、底部統計列、未選活動空狀態。
// 圖示：Figma 圖示庫沒有對應的抽獎、文件、篩選圖示，用 lucide-react 補。
export function SubmissionsView() {
  const { activities } = useActivities();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { submissions, mutate } = useSubmissions(selectedId);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [drawing, setDrawing] = useState(false);
  const [winners, setWinners] = useState<Array<{ id: string; contact: { displayName: string } }>>([]);

  const handleDraw = async () => {
    if (!selectedId) return;
    setDrawing(true);
    try {
      const res = await api.post(`/portal/activities/${selectedId}/draw`, { count: drawCount });
      setWinners(res.data.data || []);
      mutate();
    } catch (err) {
      console.error('Draw error:', err);
      alert(getApiErrorMessage(err, '抽獎失敗，請稍後重試'));
    } finally {
      setDrawing(false);
    }
  };

  const closeDraw = () => { setDrawOpen(false); setWinners([]); };

  const selectedActivity = activities.find((a: Record<string, unknown>) => a.id === selectedId);
  const isQuiz = selectedActivity?.type === 'QUIZ';
  const winnerCount = submissions.filter((s: Record<string, unknown>) => s.isWinner).length;
  const totalPoints = submissions.reduce(
    (n: number, s: Record<string, unknown>) => n + ((s.pointsEarned as number) || 0),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* 設計稿是自訂下拉（選項旁有活動類型標籤）；先沿用共用 Select，類型放在選項文字裡 */}
        <Select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="w-[340px] max-w-full"
          placeholder="選擇活動"
          options={activities.map((a: Record<string, unknown>) => ({
            value: a.id as string,
            label: `${a.title as string}（${a.type as string}）`,
          }))}
        />

        {selectedId && (
          <Button size="sm" onClick={() => setDrawOpen(true)}>
            <Award className="h-4 w-4" /> 抽獎
          </Button>
        )}
      </div>

      {selectedId ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead>
                <tr>
                  <th className="text-left">聯繫人</th>
                  <th className="w-[170px] text-left">提交時間</th>
                  <th className="text-left">答案摘要</th>
                  {isQuiz && <th className="w-[90px] text-left">得分</th>}
                  <th className="w-[110px] text-left">中獎</th>
                  <th className="w-[100px] text-right">積分</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s: Record<string, unknown>) => {
                  const contact = s.contact as Record<string, unknown> | undefined;
                  const name = (contact?.displayName as string) || '-';
                  const answers = (s.answers as Record<string, unknown>) || {};
                  const answerSummary = answers.optionIds
                    ? `選項: ${(answers.optionIds as string[]).length}`
                    : answers.fields
                    ? `欄位: ${Object.keys(answers.fields as Record<string, string>).length}`
                    : '-';
                  return (
                    <tr key={s.id as string}>
                      <td>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-muted-foreground">
                            {name.slice(0, 1)}
                          </div>
                          {/* 設計稿名稱下方有渠道與 ID（LINE · U8f2c1），提交 API 未回傳渠道，待後端提供 */}
                          <span className="truncate font-medium text-foreground">{name}</span>
                        </div>
                      </td>
                      <td className="font-mono text-[13px] text-foreground">
                        {new Date(s.createdAt as string).toLocaleString('zh-TW', { hour12: false })}
                      </td>
                      <td className="max-w-0 truncate text-[13px] text-foreground">{answerSummary}</td>
                      {isQuiz && <td className="font-mono">{(s.score as number) ?? '-'}</td>}
                      <td>
                        <Badge variant={s.isWinner ? 'success' : 'outline'} className="rounded-full">
                          {s.isWinner ? '是' : '否'}
                        </Badge>
                      </td>
                      <td className="text-right font-mono font-medium text-foreground">
                        {(s.pointsEarned as number) || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {submissions.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-5 py-16">
              <FileText className="h-7 w-7 text-tertiary-foreground" strokeWidth={1.6} />
              <p className="text-sm text-muted-foreground">尚無提交記錄</p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 border-t border-border bg-muted px-5 py-3 text-[13px] text-muted-foreground">
              <span>共 {submissions.length} 筆提交</span>
              <span>中獎 {winnerCount} 筆 · 已發放積分 {totalPoints.toLocaleString('en-US')} 點</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border px-5 py-[72px]">
          <ListFilter className="h-[30px] w-[30px] text-tertiary-foreground" strokeWidth={1.6} />
          <p className="text-sm text-muted-foreground">請先從上方選擇活動，以檢視提交紀錄</p>
        </div>
      )}

      {/* 抽獎：只有一個欄位，依規則用跳出視窗 */}
      <Dialog open={drawOpen} onOpenChange={closeDraw}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader>
            <DialogTitle>從提交名單抽獎</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] text-muted-foreground">
              將從「{(selectedActivity?.title as string) || ''}」的 {submissions.length} 筆有效提交中隨機抽出得獎者，結果會標記在中獎欄位。
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium">抽出名額</label>
              <Input
                type="number"
                className="font-mono"
                value={drawCount}
                onChange={(e) => setDrawCount(parseInt(e.target.value) || 1)}
                min={1}
              />
            </div>
            {winners.length > 0 && (
              <div>
                <label className="text-[13px] font-medium">中獎名單</label>
                <ul className="mt-2 space-y-1">
                  {winners.map((w) => (
                    <li key={w.id} className="flex items-center gap-2 text-sm">
                      <Award className="h-4 w-4 text-warning" />
                      <span>{w.contact.displayName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDraw}>{winners.length > 0 ? '關閉' : '取消'}</Button>
            <Button onClick={handleDraw} disabled={drawing}>
              {drawing && <Loader2 className="h-4 w-4 animate-spin" />}
              開始抽獎
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
