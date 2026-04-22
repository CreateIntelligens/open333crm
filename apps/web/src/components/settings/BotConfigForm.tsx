'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface BotConfig {
  botMode: string;
  maxBotReplies: number;
  handoffKeywords: string[];
  handoffMessage: string;
  offlineGreeting?: string;
}

interface BotConfigFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: {
    id: string;
    channelType: string;
    displayName: string;
    settings?: Record<string, unknown>;
  } | null;
  onSaved: () => void;
}

const botModeOptions = [
  { value: 'keyword_then_llm', label: '關鍵字 + LLM（推薦）' },
  { value: 'llm', label: '僅 LLM 回覆' },
  { value: 'keyword', label: '僅關鍵字回覆' },
  { value: 'off', label: '關閉（直接人工）' },
];

export function BotConfigForm({ open, onOpenChange, channel, onSaved }: BotConfigFormProps) {
  const [botMode, setBotMode] = useState('keyword_then_llm');
  const [maxBotReplies, setMaxBotReplies] = useState(5);
  const [handoffKeywords, setHandoffKeywords] = useState<string[]>(['真人', '人工', '客服', '轉接']);
  const [handoffMessage, setHandoffMessage] = useState('稍等，正在為您轉接客服人員');
  const [offlineGreeting, setOfflineGreeting] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (channel?.settings) {
      const bc = (channel.settings as Record<string, unknown>).botConfig as Partial<BotConfig> | undefined;
      if (bc) {
        setBotMode(bc.botMode || 'keyword_then_llm');
        setMaxBotReplies(bc.maxBotReplies ?? 5);
        setHandoffKeywords(bc.handoffKeywords ?? ['真人', '人工', '客服', '轉接']);
        setHandoffMessage(bc.handoffMessage ?? '稍等，正在為您轉接客服人員');
        setOfflineGreeting(bc.offlineGreeting ?? '');
      } else {
        // Reset to defaults
        setBotMode('keyword_then_llm');
        setMaxBotReplies(5);
        setHandoffKeywords(['真人', '人工', '客服', '轉接']);
        setHandoffMessage('稍等，正在為您轉接客服人員');
        setOfflineGreeting('');
      }
    }
    setError(null);
  }, [channel, open]);

  const handleAddKeyword = () => {
    const kw = newKeyword.trim();
    if (kw && !handoffKeywords.includes(kw)) {
      setHandoffKeywords([...handoffKeywords, kw]);
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (kw: string) => {
    setHandoffKeywords(handoffKeywords.filter((k) => k !== kw));
  };

  const handleSave = async () => {
    if (!channel) { return; }
    setSaving(true);
    setError(null);

    try {
      const existingSettings = (channel.settings || {}) as Record<string, unknown>;
      const botConfig: BotConfig = {
        botMode,
        maxBotReplies,
        handoffKeywords,
        handoffMessage,
        offlineGreeting: offlineGreeting || undefined,
      };

      await api.patch(`/channels/${channel.id}`, {
        settings: { ...existingSettings, botConfig },
      });

      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Bot 設定 — {channel?.displayName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* Bot Mode */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Bot 模式</label>
            <Select
              value={botMode}
              onChange={(e) => setBotMode(e.target.value)}
              options={botModeOptions}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {botMode === 'off' ? '新對話將直接由真人客服處理' :
               botMode === 'keyword' ? '僅根據關鍵字觸發 KB 回覆' :
               botMode === 'llm' ? '使用 LLM 自動回覆所有訊息' :
               '先檢查關鍵字規則，再使用 LLM 回覆'}
            </p>
          </div>

          {/* Max Bot Replies */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Bot 最大回覆次數</label>
            <Input
              type="number"
              min={1}
              max={50}
              value={maxBotReplies}
              onChange={(e) => setMaxBotReplies(parseInt(e.target.value, 10) || 5)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              超過此次數後自動轉接真人客服
            </p>
          </div>

          {/* Handoff Keywords */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">轉接關鍵字</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {handoffKeywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium"
                >
                  {kw}
                  <button
                    onClick={() => handleRemoveKeyword(kw)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="輸入關鍵字"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword(); } }}
                className="flex-1"
              />
              <Button size="sm" variant="outline" onClick={handleAddKeyword} type="button">
                新增
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              客戶訊息包含這些關鍵字時，自動轉接真人
            </p>
          </div>

          {/* Handoff Message */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">轉接訊息</label>
            <Textarea
              value={handoffMessage}
              onChange={(e) => setHandoffMessage(e.target.value)}
              placeholder="轉接時發送給客戶的訊息"
              rows={2}
            />
          </div>

          {/* Offline Greeting */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">非營業時間問候語</label>
            <Textarea
              value={offlineGreeting}
              onChange={(e) => setOfflineGreeting(e.target.value)}
              placeholder="留空則使用系統預設的非營業時間回覆"
              rows={2}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              非營業時間收到訊息時的自動回覆（留空使用系統預設）
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />儲存中...</>
            ) : (
              '儲存'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
