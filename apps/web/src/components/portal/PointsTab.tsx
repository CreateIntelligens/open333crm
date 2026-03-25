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

export function PointsTab() {
  const [searchTerm, setSearchTerm] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [searching, setSearching] = useState(false);
  const { transactions, mutate: mutateTx } = usePoints(contactId);
  const { balance, mutate: mutateBalance } = usePointBalance(contactId);

  // Adjust dialog
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    try {
      const res = await api.get(`/contacts?q=${encodeURIComponent(searchTerm)}&limit=1`);
      const contacts = res.data.data || [];
      if (contacts.length > 0) {
        setContactId(contacts[0].id);
        setContactName(contacts[0].displayName);
      } else {
        setContactId(null);
        setContactName('');
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleAdjust = async () => {
    if (!contactId || !adjustAmount) return;
    setAdjusting(true);
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
      console.error('Adjust error:', err);
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
          placeholder="搜尋聯繫人（名稱、電話、Email）"
          className="w-72"
        />
        <Button variant="outline" onClick={handleSearch} disabled={searching}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {contactId && (
        <>
          <div className="flex items-center gap-4">
            <span className="font-medium">{contactName}</span>
            <Badge color="#8b5cf6">
              <Coins className="h-3 w-3 mr-1 inline" />
              {balance} 點
            </Badge>
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
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
                      <td className={`p-3 text-right font-medium ${amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
            <div>
              <label className="text-sm font-medium">調整金額（正數加、負數扣）</label>
              <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-sm font-medium">備註</label>
              <Input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="調整原因" />
            </div>
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
