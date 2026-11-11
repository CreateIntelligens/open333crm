'use client';

/**
 * LINE 加好友禮設定頁（add-coupon-system design D28；spec coupon-management「加好友禮」）。
 *
 * 顧客第一次加入 LINE 官方帳號為好友時自動發一張券。底層是租戶唯一的一條自動化規則：
 * 事件「加入好友」（contact.followed）、固定條件「第一次加入等於是」與「對話渠道等於 LINE」、
 * 動作「發送優惠券」。封鎖後再加入不發券（使用者決定）。
 */

import React, { useEffect, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { CouponSelectField } from '@/components/coupons/CouponSelectField';
import { saveFollowGift, useFollowGift } from '@/hooks/useFollowGift';

const FAILURE_TEXT_MAX = 500;

export default function FollowGiftPage() {
  const { gift, otherRules, isLoading, error: loadError, mutate } = useFollowGift();
  const [enabled, setEnabled] = useState(false);
  const [couponId, setCouponId] = useState('');
  const [failureText, setFailureText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // 載入既有規則後帶入表單
  useEffect(() => {
    if (isLoading) return;
    setEnabled(gift?.isActive ?? false);
    setCouponId(gift?.couponId ?? '');
    setFailureText(gift?.failureText ?? '');
  }, [gift, isLoading]);

  const handleSave = async () => {
    setError(null);
    setSavedAt(null);
    if (enabled && !couponId) {
      setError('啟用加好友禮要選一張優惠券');
      return;
    }
    if (!couponId && !gift) {
      // 沒有規則、也沒有選券：沒有東西要存
      setSavedAt(new Date());
      return;
    }
    setSaving(true);
    try {
      // 停用時沒有選券：保留規則原本的券，只停用
      await saveFollowGift(gift, { enabled, couponId: couponId || gift?.couponId || '', failureText });
      await mutate();
      setSavedAt(new Date());
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '儲存失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="LINE 管理" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <header>
            <h1 className="text-2xl font-bold tracking-tight">加好友禮</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              顧客第一次加入 LINE 官方帳號為好友時，自動發一張優惠券給他。
            </p>
          </header>

          <section className="rounded-lg border border-border bg-white p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Info className="h-4 w-4 text-primary" />
              怎麼運作？
            </div>
            <ul className="ml-1 mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>只發給第一次加入好友的顧客；封鎖後再加入不會再發。這個功能上線前就是好友的顧客，封鎖後再加入也不會發。</li>
              <li>券在顧客加入後立即以回覆方式送出，不計入 LINE 主動推送的訊息額度；超過回覆期限時改用主動推送。</li>
              <li>對所有 LINE 官方帳號生效。有設定首次招呼語時，顧客會先收到招呼語，再收到這張券。</li>
              <li>券沒有發出時（例如名額已滿），原因會記在該顧客的對話中。</li>
            </ul>
          </section>

          {loadError && (
            <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
              無法載入加好友禮設定（可能沒有自動化規則的權限），請重新整理或洽管理員。
            </div>
          )}

          {!isLoading && otherRules.length > 0 && (
            <section className="rounded-md border border-primary-border bg-primary-subtle px-4 py-3 text-sm">
              <p>
                {`另有 ${otherRules.length} 條「加入好友」規則（不發券，在自動化規則設定）。加好友禮會另外建立一條，顧客加入好友時兩條都會執行。`}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {otherRules.map((r) => (
                  <li key={r.id}>
                    <a href={`/dashboard/automation/${r.id}`} className="text-primary underline">{r.name}</a>
                    {!r.isActive && <span className="ml-1 text-xs text-muted-foreground">（已停用）</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              載入中…
            </div>
          ) : (
            <section className="space-y-5 rounded-lg border border-border bg-white p-5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label="啟用加好友禮"
                  onClick={() => setEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${enabled ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span
                    className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
                <span className="text-sm font-medium">{enabled ? '已啟用' : '未啟用'}</span>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">發送條件</div>
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  只發給第一次加入好友的顧客（固定條件）
                </div>
              </div>

              <CouponSelectField
                id="follow-gift-coupon"
                label="加好友時發送的優惠券"
                value={couponId}
                onChange={setCouponId}
                emptyLabel="— 請選擇優惠券 —"
              />

              <div>
                <label htmlFor="follow-gift-failure-text" className="mb-1 block text-xs font-semibold text-muted-foreground">
                  發不出時回覆顧客
                </label>
                <textarea
                  id="follow-gift-failure-text"
                  value={failureText}
                  onChange={(e) => setFailureText(e.target.value.slice(0, FAILURE_TEXT_MAX))}
                  rows={2}
                  placeholder="例：新朋友優惠券已經發完了，歡迎關注下一波活動"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  選填。名額已滿、序號用完或券已暫停時送出這段文字；沒有填寫就不回覆。
                </p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {savedAt && !error && <p className="text-sm text-success">已儲存</p>}

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  儲存
                </Button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
