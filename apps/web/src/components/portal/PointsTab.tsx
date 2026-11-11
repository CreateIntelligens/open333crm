'use client';

import React, { useState } from 'react';
import { Search, Loader2, Coins } from 'lucide-react';
import { usePoints, usePointBalance } from '@/hooks/usePortal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';

interface ContactCandidate {
  id: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
}

/** 名稱可能重複：附上電話與 Email 讓使用者分辨是哪一位 */
function contactDetail(c: ContactCandidate): string {
  return [c.phone, c.email].filter(Boolean).join('・') || '沒有電話與 Email';
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || fallback;
}

export function PointsTab() {
  const [searchTerm, setSearchTerm] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactCandidate | null>(null);
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const { transactions, mutate: mutateTx } = usePoints(contactId);
  const { balance, mutate: mutateBalance } = usePointBalance(contactId);

  // Adjust dialog
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const selectContact = (c: ContactCandidate | null) => {
    setSelected(c);
    setContactId(c?.id ?? null);
  };

  // 以前只取第一筆（limit=1），同名或部分相符時會選到別人，接著加扣到錯的客戶。
  // 現在只有剛好一筆時才自動選；多筆時列出名稱、電話、Email 讓使用者挑。
  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    setSearchMessage(null);
    setCandidates([]);
    selectContact(null);
    try {
      const res = await api.get(`/contacts?q=${encodeURIComponent(searchTerm.trim())}&limit=20`);
      const contacts: ContactCandidate[] = res.data.data || [];
      const total: number = res.data.meta?.total ?? contacts.length;
      if (contacts.length === 0) {
        setSearchMessage('找不到符合的聯絡人');
      } else if (contacts.length === 1) {
        selectContact(contacts[0]);
      } else {
        setCandidates(contacts);
        setSearchMessage(
          total > contacts.length
            ? `符合的聯絡人超過 ${contacts.length} 位，只列出前 ${contacts.length} 位，請輸入更完整的電話或 Email`
            : `有 ${contacts.length} 位符合，請選擇要調整的聯絡人`,
        );
      }
    } catch (err) {
      setSearchMessage(errorMessage(err, '搜尋失敗，請稍後再試'));
    } finally {
      setSearching(false);
    }
  };

  const handleAdjust = async () => {
    if (!contactId || !adjustAmount) return;
    setAdjusting(true);
    setAdjustError(null);
    try {
      await api.post('/portal/points/adjust', {
        contactId,
        amount: adjustAmount,
        note: adjustNote || undefined,
      });
      setAdjustOpen(false);
      setAdjustAmount(0);
      setAdjustNote('');
      mutateTx();
      mutateBalance();
    } catch (err) {
      setAdjustError(errorMessage(err, '調整失敗，請稍後再試'));
    } finally {
      setAdjusting(false);
    }
  };

  const typeLabels: Record<string, string> = {
    activity_submit: '活動參與',
    admin_adjust: '人工調整',
    reward_redeem: '兌換扣除',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜尋聯絡人（名稱、電話、Email）"
          className="w-72"
        />
        <Button variant="outline" onClick={handleSearch} disabled={searching}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {searchMessage && <p className="text-sm text-muted-foreground">{searchMessage}</p>}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border p-2">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectContact(c)}
              className={`rounded px-3 py-2 text-left text-sm hover:bg-muted ${selected?.id === c.id ? 'bg-muted font-medium' : ''}`}
            >
              {c.displayName}
              <span className="ml-2 text-xs text-muted-foreground">{contactDetail(c)}</span>
            </button>
          ))}
        </div>
      )}

      {contactId && selected && (
        <>
          <div className="flex items-center gap-4">
            <span className="font-medium">{selected.displayName}</span>
            <span className="text-xs text-muted-foreground">{contactDetail(selected)}</span>
            <Badge color="#8b5cf6">
              <Coins className="h-3 w-3 mr-1 inline" />
              {balance} 點
            </Badge>
            <Button size="sm" variant="outline" onClick={() => { setAdjustError(null); setAdjustOpen(true); }}>
              手動調整
            </Button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3">時間</th>
                  <th className="text-left p-3">類型</th>
                  <th className="text-right p-3">金額</th>
                  <th className="text-right p-3">餘額</th>
                  <th className="text-left p-3">備註</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: Record<string, unknown>) => {
                  const amount = tx.amount as number;
                  return (
                    <tr key={tx.id as string} className="border-t">
                      <td className="p-3">{new Date(tx.createdAt as string).toLocaleString('zh-TW')}</td>
                      <td className="p-3">{typeLabels[tx.type as string] || (tx.type as string)}</td>
                      <td className={`p-3 text-right font-medium ${amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {amount >= 0 ? '+' : ''}{amount}
                      </td>
                      <td className="p-3 text-right">{tx.balance as number}</td>
                      <td className="p-3 text-muted-foreground">{(tx.note as string) || '-'}</td>
                    </tr>
                  );
                })}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      尚無交易記錄
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Adjust Dialog */}
      <Dialog open={adjustOpen} onOpenChange={() => setAdjustOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手動調整積分</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selected && (
              <p className="text-sm">
                調整對象：<span className="font-medium">{selected.displayName}</span>
                <span className="ml-2 text-xs text-muted-foreground">{contactDetail(selected)}</span>
              </p>
            )}
            <div>
              <label className="text-sm font-medium">調整金額（正數加、負數扣）</label>
              <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-sm font-medium">備註</label>
              <Input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="調整原因" />
            </div>
            {adjustError && <p className="text-sm text-destructive">{adjustError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>取消</Button>
            <Button onClick={handleAdjust} disabled={adjusting || !adjustAmount}>
              {adjusting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              確認調整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
