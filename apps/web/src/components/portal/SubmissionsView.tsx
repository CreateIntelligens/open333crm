'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState } from 'react';
import { Award, Loader2 } from 'lucide-react';
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

export function SubmissionsView() {
  const { activities } = useActivities();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { submissions, mutate } = useSubmissions(selectedId);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [drawing, setDrawing] = useState(false);
  const [winners, setWinners] = useState<Array<{ id: string; contact: { displayName: string } }>>([]);

  const handleDraw = async () => {
    if (!selectedId) { return; }
    setDrawing(true);
    try {
      const res = await api.post(`/portal/activities/${selectedId}/draw`, { count: drawCount });
      setWinners(res.data.data || []);
      mutate();
    } catch (err) {
      console.error('Draw error:', err);
    } finally {
      setDrawing(false);
    }
  };

  const selectedActivity = activities.find((a: Record<string, unknown>) => a.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="w-64"
          placeholder="選擇活動"
          options={activities.map((a: Record<string, unknown>) => ({
            value: a.id as string,
            label: `${a.title as string} (${a.type as string})`,
          }))}
        />

        {selectedId && (
          <Button variant="outline" onClick={() => setDrawOpen(true)}>
            <Award className="h-4 w-4 mr-1" /> 抽獎
          </Button>
        )}
      </div>

      {selectedId && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3">聯繫人</th>
                <th className="text-left p-3">提交時間</th>
                <th className="text-left p-3">答案摘要</th>
                {selectedActivity?.type === 'QUIZ' && <th className="text-left p-3">得分</th>}
                <th className="text-left p-3">中獎</th>
                <th className="text-left p-3">積分</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s: Record<string, unknown>) => {
                const contact = s.contact as Record<string, unknown>;
                const answers = s.answers as Record<string, unknown>;
                const answerSummary = answers.optionIds
                  ? `選項: ${(answers.optionIds as string[]).length}`
                  : answers.fields
                  ? `欄位: ${Object.keys(answers.fields as Record<string, string>).length}`
                  : '-';
                return (
                  <tr key={s.id as string} className="border-t">
                    <td className="p-3">{contact?.displayName as string}</td>
                    <td className="p-3">{new Date(s.createdAt as string).toLocaleString('zh-TW')}</td>
                    <td className="p-3 text-muted-foreground">{answerSummary}</td>
                    {selectedActivity?.type === 'QUIZ' && <td className="p-3">{s.score as number ?? '-'}</td>}
                    <td className="p-3">
                      {s.isWinner ? <Badge color="#22c55e">中獎</Badge> : '-'}
                    </td>
                    <td className="p-3">{s.pointsEarned ? `+${s.pointsEarned}` : '-'}</td>
                  </tr>
                );
              })}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    尚無提交記錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Draw Dialog */}
      <Dialog open={drawOpen} onOpenChange={() => { setDrawOpen(false); setWinners([]); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>隨機抽獎</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">抽出人數</label>
              <Input type="number" value={drawCount} onChange={(e) => setDrawCount(parseInt(e.target.value, 10) || 1)} min={1} />
            </div>
            {winners.length > 0 && (
              <div>
                <label className="text-sm font-medium">中獎名單</label>
                <ul className="mt-2 space-y-1">
                  {winners.map((w) => (
                    <li key={w.id} className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-yellow-500" />
                      <span>{w.contact.displayName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDrawOpen(false); setWinners([]); }}>關閉</Button>
            <Button onClick={handleDraw} disabled={drawing}>
              {drawing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              抽獎
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
