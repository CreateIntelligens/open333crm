'use client';

/**
 * Bot 設定的「測試 LIFF 設定」（change add-liff-config-test）：產生測試連結與 QR code，
 * 管理者用手機 LINE 開啟後，定期查詢手機回報的結果並顯示說明。
 * 測試的是已存檔的設定，所以設定改過還沒儲存時不能測。
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/coupon/labels';

export interface LiffValues {
  liffId: string;
  loginChannelId: string;
}

/** 渠道 settings.liffTest：最後一次測試成功的時間與設定值 */
export interface LiffTestRecord extends LiffValues {
  verifiedAt: string;
}

interface StartedTest {
  testId: string;
  testUrl: string;
  qrCode: string;
}

type TestResult = { status: 'pending' } | { status: 'expired' } | { status: string; message: string };

interface Props {
  channelId: string;
  /** 已存檔的值 */
  saved: LiffValues;
  /** 表單上目前的值 */
  draft: LiffValues;
  lastTest: LiffTestRecord | null;
  /** 查詢結果的間隔（毫秒），測試縮短用 */
  pollMs?: number;
}

const same = (a: LiffValues, b: LiffValues) =>
  a.liffId.trim() === b.liffId.trim() && a.loginChannelId.trim() === b.loginChannelId.trim();

export function LiffTestPanel({ channelId, saved, draft, lastTest, pollMs = 2000 }: Props) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<StartedTest | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);

  const complete = Boolean(saved.liffId.trim() && saved.loginChannelId.trim());
  const unsaved = !same(saved, draft);
  const canTest = complete && !unsaved && !starting;
  const showLastTest = lastTest !== null && complete && same(lastTest, saved);

  // 收到結果（或連結過期）就停止查詢；元件卸載時也停止
  useEffect(() => {
    if (!test) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await api.get(`/channels/${channelId}/liff-test/${test.testId}`);
        if (stopped) return;
        const next = res.data.data as TestResult;
        setResult(next);
        if (next.status !== 'pending') return;
      } catch {
        // 查詢偶發失敗時繼續等；連結過期後會收到 expired
        if (stopped) return;
      }
      timer = setTimeout(poll, pollMs);
    };
    timer = setTimeout(poll, pollMs);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [test, channelId, pollMs]);

  const start = async () => {
    setStarting(true);
    setError(null);
    setResult(null);
    setTest(null);
    try {
      const res = await api.post(`/channels/${channelId}/liff-test`);
      setTest(res.data.data as StartedTest);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
      setError(message || '無法產生測試連結，請稍後再試');
    } finally {
      setStarting(false);
    }
  };

  const waiting = test !== null && (result === null || result.status === 'pending');

  return (
    <div className="mt-3 rounded-md border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={start} disabled={!canTest}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : '測試 LIFF 設定'}
        </Button>
        {showLastTest && (
          <span className="text-success">上次測試成功：{formatDateTime(lastTest.verifiedAt)}</span>
        )}
      </div>
      {(unsaved || !complete) && (
        <p className="mt-2 text-muted-foreground">
          {unsaved ? '請先儲存 LIFF App ID 與 LINE Login Channel ID，再測試。' : '填好並儲存 LIFF App ID 與 LINE Login Channel ID 後即可測試。'}
        </p>
      )}

      {error && <p className="mt-2 text-destructive">{error}</p>}

      {test && (
        <div className="mt-3 flex flex-wrap gap-3">
          <img src={test.qrCode} alt="LIFF 測試連結 QR code" className="h-32 w-32 rounded border bg-white" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p>用手機 LINE 掃描 QR code，或在手機的 LINE 開啟下方連結。測試連結 10 分鐘內有效，結果會同時顯示在手機和這裡。</p>
            <a href={test.testUrl} target="_blank" rel="noreferrer" className="block break-all text-primary underline">
              {test.testUrl}
            </a>
            <p className="text-muted-foreground">請用已經加官方帳號好友的 LINE 帳號測試。</p>
          </div>
        </div>
      )}

      {waiting && (
        <p className="mt-2 flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> 等待手機的測試結果…
        </p>
      )}

      {result && result.status === 'expired' && (
        <div data-liff-test-result className="mt-2 space-y-1 text-destructive">
          <p>測試連結已過期，沒有收到手機的測試結果。常見原因：</p>
          <ul className="list-disc pl-4">
            <li>手機的 LINE 顯示錯誤頁：LIFF App ID 錯誤，或 LIFF App 已刪除。</li>
            <li>手機開到其他網頁：LIFF App 的 Endpoint URL 沒有指向本系統的 /liff/redirect。</li>
          </ul>
        </div>
      )}

      {result && 'message' in result && (
        <p data-liff-test-result className={`mt-2 ${result.status === 'verified' ? 'text-success' : 'text-destructive'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
