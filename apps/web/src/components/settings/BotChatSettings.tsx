'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentPicker } from '@/components/common/AgentPicker';
import { TeamPicker } from '@/components/common/TeamPicker';
import api from '@/lib/api';

export function BotChatSettings() {
  // Sentiment-aware handoff
  const [handoffEnabled, setHandoffEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0.6);
  const [sentimentTriggersHandoff, setSentimentTriggersHandoff] = useState(false);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatSaving, setChatSaving] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // BOT inactivity auto-close
  const [inactivityMinutes, setInactivityMinutes] = useState(60);
  const [inactivityLoading, setInactivityLoading] = useState(true);
  const [inactivitySaving, setInactivitySaving] = useState(false);
  const [inactivityError, setInactivityError] = useState<string | null>(null);

  // Handoff fallback (no rule matched)
  const [fallbackMode, setFallbackMode] = useState<'none' | 'agent' | 'team'>('none');
  const [fallbackAgentId, setFallbackAgentId] = useState<string>('');
  const [fallbackTeamId, setFallbackTeamId] = useState<string>('');
  const [fallbackLoading, setFallbackLoading] = useState(true);
  const [fallbackSaving, setFallbackSaving] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  const fetchChat = useCallback(async () => {
    try {
      setChatError(null);
      const res = await api.get('/settings/chat');
      const settings = res.data?.data?.settings ?? res.data?.settings;
      if (settings) {
        setHandoffEnabled(settings.handoffOnNegativeSentiment ?? true);
        setThreshold(
          typeof settings.negativeSentimentThreshold === 'number'
            ? settings.negativeSentimentThreshold
            : 0.6,
        );
        setSentimentTriggersHandoff(settings.sentimentTriggersHandoff ?? false);
      }
    } catch (err: any) {
      console.error('Failed to fetch chat settings:', err);
      setChatError(err?.response?.data?.error?.message || '載入失敗');
    } finally {
      setChatLoading(false);
    }
  }, []);

  const fetchInactivity = useCallback(async () => {
    try {
      setInactivityError(null);
      const res = await api.get('/settings/bot-inactivity');
      const data = res.data?.data ?? res.data;
      if (data?.botInactivityMinutes) {
        setInactivityMinutes(data.botInactivityMinutes);
      }
    } catch (err: any) {
      console.error('Failed to fetch bot inactivity settings:', err);
      setInactivityError(err?.response?.data?.error?.message || '載入失敗');
    } finally {
      setInactivityLoading(false);
    }
  }, []);

  const fetchFallback = useCallback(async () => {
    try {
      setFallbackError(null);
      const res = await api.get('/settings/handoff-fallback');
      const data = res.data?.data ?? res.data;
      if (data) {
        if (data.handoffFallbackAgentId) {
          setFallbackMode('agent');
          setFallbackAgentId(data.handoffFallbackAgentId);
          setFallbackTeamId('');
        } else if (data.handoffFallbackTeamId) {
          setFallbackMode('team');
          setFallbackTeamId(data.handoffFallbackTeamId);
          setFallbackAgentId('');
        } else {
          setFallbackMode('none');
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch handoff fallback:', err);
      setFallbackError(err?.response?.data?.error?.message || '載入失敗');
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChat();
    fetchInactivity();
    fetchFallback();
  }, [fetchChat, fetchInactivity, fetchFallback]);

  const saveChat = async () => {
    setChatSaving(true);
    setChatError(null);
    try {
      await api.put('/settings/chat', {
        handoffOnNegativeSentiment: handoffEnabled,
        negativeSentimentThreshold: threshold,
        sentimentTriggersHandoff,
      });
      alert('情感轉接設定已儲存');
    } catch (err: any) {
      console.error('Failed to save chat settings:', err);
      setChatError(err?.response?.data?.error?.message || '儲存失敗');
    } finally {
      setChatSaving(false);
    }
  };

  const saveInactivity = async () => {
    if (inactivityMinutes < 60) {
      setInactivityError('最小 60 分鐘');
      return;
    }
    setInactivitySaving(true);
    setInactivityError(null);
    try {
      const res = await api.put('/settings/bot-inactivity', {
        botInactivityMinutes: inactivityMinutes,
      });
      const data = res.data?.data ?? res.data;
      if (data?.botInactivityMinutes && data.botInactivityMinutes !== inactivityMinutes) {
        setInactivityMinutes(data.botInactivityMinutes);
      }
      alert('BOT 閒置自動結束設定已儲存');
    } catch (err: any) {
      console.error('Failed to save bot inactivity settings:', err);
      setInactivityError(err?.response?.data?.error?.message || '儲存失敗');
    } finally {
      setInactivitySaving(false);
    }
  };

  const saveFallback = async () => {
    setFallbackSaving(true);
    setFallbackError(null);
    try {
      const body: { handoffFallbackAgentId: string | null; handoffFallbackTeamId: string | null } = {
        handoffFallbackAgentId: null,
        handoffFallbackTeamId: null,
      };
      if (fallbackMode === 'agent' && fallbackAgentId) {
        body.handoffFallbackAgentId = fallbackAgentId;
      } else if (fallbackMode === 'team' && fallbackTeamId) {
        body.handoffFallbackTeamId = fallbackTeamId;
      }
      await api.put('/settings/handoff-fallback', body);
      alert('Fallback 設定已儲存');
    } catch (err: any) {
      console.error('Failed to save handoff fallback:', err);
      setFallbackError(err?.response?.data?.error?.message || '儲存失敗');
    } finally {
      setFallbackSaving(false);
    }
  };

  if (chatLoading || inactivityLoading || fallbackLoading) {
    return <div className="p-4 text-ink-subtle">載入中...</div>;
  }

  const thresholdInvalid = threshold < 0 || threshold > 1 || Number.isNaN(threshold);
  const inactivityInvalid = inactivityMinutes < 60 || !Number.isFinite(inactivityMinutes);

  return (
    <div className="space-y-10 max-w-2xl">
      {/* Section A: Sentiment-aware handoff */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-1">智慧轉接提示</h2>
          <p className="text-sm text-ink-subtle">
            當系統偵測到使用者明顯不滿意 AI 回答時，BOT 會在回覆後加上「需要真人客服協助嗎？」轉接提示。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={handoffEnabled}
            onClick={() => setHandoffEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${handoffEnabled ? 'bg-primary' : 'bg-surface-canvas'}`}
          >
            <span
              className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${handoffEnabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-sm font-medium">
            {handoffEnabled ? '已啟用：偵測到不滿意時提示轉接' : '未啟用：不會提示轉接'}
          </span>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">負面情感判定信心閾值</label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              disabled={!handoffEnabled}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-32"
            />
            <span className="text-xs text-ink-subtle">
              建議 0.5–0.8。值越高越嚴格（更不容易誤觸發轉接提示）。
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            role="switch"
            aria-checked={sentimentTriggersHandoff}
            disabled={!handoffEnabled}
            onClick={() => setSentimentTriggersHandoff((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${sentimentTriggersHandoff && handoffEnabled ? 'bg-primary' : 'bg-surface-canvas'}`}
          >
            <span
              className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${sentimentTriggersHandoff && handoffEnabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-sm font-medium">
            偵測到不滿時，自動轉真人並觸發指派規則
          </span>
        </div>
        <p className="text-xs text-ink-subtle -mt-2 pl-14">
          開啟後，BOT 不會再回覆，對話會立即進入 AGENT_HANDLED，並依照指派規則 / Fallback 通知客服。
        </p>

        {chatError && <div className="text-sm text-destructive">{chatError}</div>}

        <Button onClick={saveChat} disabled={chatSaving || thresholdInvalid}>
          {chatSaving ? '儲存中…' : '儲存情感轉接設定'}
        </Button>
      </section>

      {/* Section B: BOT inactivity auto-close */}
      <section className="space-y-4 pt-6 border-t">
        <div>
          <h2 className="text-lg font-semibold mb-1">BOT 對話閒置自動結束</h2>
          <p className="text-sm text-ink-subtle">
            當 BOT 對話超過設定時間沒有新訊息，系統會自動結束該對話（不影響真人接手中的對話）。
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">閒置時間（分鐘）</label>
          <Input
            type="number"
            min={60}
            step={60}
            value={inactivityMinutes}
            onChange={(e) => setInactivityMinutes(Number(e.target.value))}
            className="w-40"
          />
          <p className="text-xs text-ink-subtle">
            最小 60 分鐘起跳。儲存以小時為單位（會四捨五入到整點）。例如輸入 90 會以 2 小時儲存並顯示為 120 分鐘。
          </p>
        </div>

        {inactivityError && (
          <div className="text-sm text-destructive">{inactivityError}</div>
        )}

        <Button
          onClick={saveInactivity}
          disabled={inactivitySaving || inactivityInvalid}
        >
          {inactivitySaving ? '儲存中…' : '儲存閒置設定'}
        </Button>
      </section>

      {/* Section C: Handoff fallback */}
      <section className="space-y-4 pt-6 border-t">
        <div>
          <h2 className="text-lg font-semibold mb-1">轉真人 Fallback 指派</h2>
          <p className="text-sm text-ink-subtle">
            當對話轉真人但<strong className="text-foreground">沒有任何規則匹配</strong>時，由此設定決定預設指派對象。
            未設定時，對話會留在「未指派」狀態，須由主管手動處理。
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="fallback-mode"
              checked={fallbackMode === 'none'}
              onChange={() => setFallbackMode('none')}
            />
            不設定 Fallback（保持未指派）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="fallback-mode"
              checked={fallbackMode === 'agent'}
              onChange={() => setFallbackMode('agent')}
            />
            指派給特定客服
          </label>
          {fallbackMode === 'agent' && (
            <div className="pl-6">
              <AgentPicker
                value={fallbackAgentId}
                onChange={setFallbackAgentId}
                placeholder="選擇客服"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="fallback-mode"
              checked={fallbackMode === 'team'}
              onChange={() => setFallbackMode('team')}
            />
            依團隊輪流指派（負載最少）
          </label>
          {fallbackMode === 'team' && (
            <div className="pl-6">
              <TeamPicker
                value={fallbackTeamId}
                onChange={setFallbackTeamId}
                placeholder="選擇團隊"
              />
            </div>
          )}
        </div>

        {fallbackError && <div className="text-sm text-destructive">{fallbackError}</div>}

        <Button
          onClick={saveFallback}
          disabled={
            fallbackSaving ||
            (fallbackMode === 'agent' && !fallbackAgentId) ||
            (fallbackMode === 'team' && !fallbackTeamId)
          }
        >
          {fallbackSaving ? '儲存中…' : '儲存 Fallback 設定'}
        </Button>
      </section>
    </div>
  );
}
