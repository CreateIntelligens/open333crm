'use client';

/**
 * 店員核銷台（/redeem）。以門市帳號登入（design D13），掃描或輸入券號 → 查券預覽 → 確認核銷 → 結果。
 *
 * 帳號檢查的時機：開啟、查券、確認核銷、查看今日紀錄（spec「核銷台每次操作都檢查帳號狀態」）。
 * 任何一支 API 回帳號錯誤碼，都切到對應的狀態卡，按鈕回登入頁並帶對應橫幅。
 * 櫃檯共用手機（閒置鎖定、解鎖碼）待 PM 確認，這版不做。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  clearStoreToken,
  getMe,
  getStoreToken,
  getToday,
  lookupCoupon,
  redeemCoupon,
  setStoreToken,
  type LoginResponse,
  type StoreCoupon,
} from '@/lib/store-console-api';
import { newRedeemKey, vibrate } from '@/hooks/useStoreConsole';
import { ConfirmScreen } from './ConfirmScreen';
import { accountCard, classifyError, NETWORK_TEXT, type AccountErrorCode, type LoginBanner } from './errors';
import { LoginScreen } from './LoginScreen';
import { MainScreen, type Tab } from './MainScreen';
import {
  accountView,
  failureFromLookup,
  failureView,
  networkView,
  REDEEM_FAILURE,
  successView,
  type AccountErrorTiming,
  type ResultAction,
  type ResultView,
} from './outcomes';
import { RecordsScreen } from './RecordsScreen';
import { ResultScreen } from './ResultScreen';
import type { LastScan } from './ScanPanel';
import { Button, Page } from './ui';

type Screen =
  | { name: 'boot' }
  | { name: 'bootError'; message: string }
  | { name: 'login'; banner?: LoginBanner }
  | { name: 'main' }
  | { name: 'confirm'; coupon: StoreCoupon; submitting: boolean; error?: string | null }
  | { name: 'result'; view: ResultView; banner?: LoginBanner; retry?: { coupon: StoreCoupon; key: string } }
  | { name: 'records' };

interface Session {
  storeName: string;
  username: string;
}

export function StoreConsoleApp({ storeId }: { storeId: string | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'boot' });
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('scan');
  const [manualValue, setManualValue] = useState('');
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const lastScanRef = useRef<LastScan | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  const username = session?.username ?? null;

  /** 切到帳號錯誤狀態卡。開啟時登入已過期就直接回登入頁（店員不在顧客面前，不需要多一張卡） */
  const showAccountError = useCallback(
    (code: AccountErrorCode, timing: AccountErrorTiming, account: string | null, coupon?: StoreCoupon) => {
      setLookingUp(false);
      const card = accountCard(code);
      if (timing === 'open' && card.banner === 'expired') {
        clearStoreToken();
        setScreen({ name: 'login', banner: 'expired' });
        return;
      }
      vibrate([220, 120, 220]);
      setScreen({ name: 'result', view: accountView(code, timing, account, coupon), banner: card.banner });
    },
    [],
  );

  /** 更新「紀錄 N」。失敗時只是不顯示筆數，下一個操作會再檢查帳號狀態並顯示錯誤 */
  const refreshCount = useCallback(() => {
    getToday()
      .then((r) => setRecordCount(r.summary.count))
      .catch(() => setRecordCount(null));
  }, []);

  const enterMain = useCallback(
    (s: Session, canRedeem: boolean) => {
      setSession(s);
      if (!canRedeem) {
        showAccountError('NO_REDEEM_PERMISSION', 'open', s.username);
        return;
      }
      setTab('scan');
      setLookupError(null);
      setScreen({ name: 'main' });
      refreshCount();
    },
    [refreshCount, showAccountError],
  );

  // 開啟核銷台：有門市憑證就檢查帳號狀態，否則顯示登入頁
  useEffect(() => {
    let cancelled = false;
    if (!getStoreToken()) {
      setScreen({ name: 'login' });
      return;
    }
    getMe()
      .then((me) => {
        if (!cancelled) enterMain({ storeName: me.store.name, username: me.account.username }, me.account.canRedeem);
      })
      .catch((err) => {
        if (cancelled) return;
        const c = classifyError(err);
        if (c.kind === 'account') showAccountError(c.code, 'open', null);
        else setScreen({ name: 'bootError', message: c.kind === 'other' ? c.message : NETWORK_TEXT });
      });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt, enterMain, showAccountError]);

  function handleLoggedIn(res: LoginResponse, remember: boolean) {
    setStoreToken(res.token, remember);
    enterMain({ storeName: res.storeName, username: res.username }, res.canRedeem);
  }

  function goLogin(banner?: LoginBanner) {
    clearStoreToken();
    setSession(null);
    setRecordCount(null);
    setManualValue('');
    setScreen({ name: 'login', banner });
  }

  function backToMain(nextTab: Tab) {
    setTab(nextTab);
    setLookupError(null);
    setLookingUp(false);
    setScreen({ name: 'main' });
  }

  // 「確認」或「取消」要回到的分頁：掃描進來的回掃描，手動進來的回手動
  const originRef = useRef<Tab>('scan');

  async function handleLookup(code: string, from: Tab) {
    if (lookingUp) return;
    originRef.current = from;
    setLookingUp(true);
    setLookupError(null);
    try {
      const r = await lookupCoupon(code);
      setLookingUp(false);
      if (r.result === 'OK' && r.coupon) {
        setScreen({ name: 'confirm', coupon: r.coupon, submitting: false });
      } else {
        vibrate([220, 120, 220]);
        // 掃到的碼查無此券時，「確認序號後重新輸入」要帶著這個碼進手動分頁
        if (r.result === 'NOT_FOUND' && from === 'scan') setManualValue(code.toUpperCase());
        setScreen({ name: 'result', view: failureView(failureFromLookup(code, r)) });
      }
    } catch (err) {
      setLookingUp(false);
      const c = classifyError(err);
      if (c.kind === 'account') showAccountError(c.code, 'lookup', username);
      else setLookupError(c.kind === 'other' ? c.message : NETWORK_TEXT);
    }
  }

  async function submitRedeem(coupon: StoreCoupon, key: string) {
    setScreen({ name: 'confirm', coupon, submitting: true });
    try {
      const r = await redeemCoupon(coupon.code, key);
      if (r.ok) {
        vibrate(80);
        setScreen({ name: 'result', view: successView({ coupon: r.coupon ?? coupon, redeemedAt: r.redeemedAt, storeName: r.storeName }) });
        refreshCount();
      } else {
        vibrate([220, 120, 220]);
        setScreen({
          name: 'result',
          view: failureView({
            key: REDEEM_FAILURE[r.reason],
            code: coupon.code,
            coupon: r.coupon ?? coupon,
            redeemedAt: r.redeemedAt,
            redeemedStoreName: r.redeemedStoreName,
          }),
        });
      }
    } catch (err) {
      const c = classifyError(err);
      if (c.kind === 'account') showAccountError(c.code, 'confirm', username, coupon);
      else if (c.kind === 'network') setScreen({ name: 'result', view: networkView(coupon), retry: { coupon, key } });
      else setScreen({ name: 'confirm', coupon, submitting: false, error: c.kind === 'other' ? c.message : NETWORK_TEXT });
    }
  }

  function handleResultAction(action: ResultAction) {
    if (screen.name !== 'result') return;
    switch (action) {
      case 'login':
        goLogin(screen.banner);
        return;
      case 'retry':
        // 網路錯誤重試：沿用同一個重試鍵，後端保證不重複核銷
        if (screen.retry) void submitRedeem(screen.retry.coupon, screen.retry.key);
        return;
      case 'manual':
        backToMain('manual');
        return;
      case 'cancel':
        backToMain(originRef.current);
        return;
      default:
        backToMain('scan');
    }
  }

  switch (screen.name) {
    case 'boot':
      return (
        <Page>
          <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            載入中…
          </div>
        </Page>
      );
    case 'bootError':
      return (
        <Page>
          <div className="flex flex-1 flex-col justify-center gap-4 px-6">
            <p role="alert" className="text-center text-base font-medium text-destructive">
              {screen.message}
            </p>
            <Button
              onClick={() => {
                setScreen({ name: 'boot' });
                setBootAttempt((n) => n + 1);
              }}
            >
              重新嘗試
            </Button>
            <Button variant="outline" onClick={() => goLogin()}>
              重新登入
            </Button>
          </div>
        </Page>
      );
    case 'login':
      return (
        <LoginScreen
          key={screen.banner ?? 'none'}
          storeId={storeId}
          banner={screen.banner}
          onLoggedIn={handleLoggedIn}
          onAccountError={(code, account) => showAccountError(code, 'open', account)}
        />
      );
    case 'confirm':
      return (
        <ConfirmScreen
          coupon={screen.coupon}
          storeName={session?.storeName ?? ''}
          submitting={screen.submitting}
          error={screen.error}
          onCancel={() => backToMain(originRef.current)}
          onConfirm={() => void submitRedeem(screen.coupon, newRedeemKey())}
        />
      );
    case 'result':
      return <ResultScreen view={screen.view} onAction={handleResultAction} />;
    case 'records':
      return (
        <RecordsScreen
          storeName={session?.storeName ?? ''}
          onBack={() => backToMain(originRef.current)}
          onLoaded={setRecordCount}
          onAccountError={(code) => showAccountError(code, 'records', username)}
        />
      );
    default:
      return (
        <MainScreen
          storeName={session?.storeName ?? ''}
          username={username ?? ''}
          tab={tab}
          onTab={(t) => {
            setTab(t);
            setLookupError(null);
          }}
          recordCount={recordCount}
          onRecords={() => {
            originRef.current = tab;
            setScreen({ name: 'records' });
          }}
          onLogout={() => goLogin()}
          manualValue={manualValue}
          onManualChange={(v) => {
            setManualValue(v);
            setLookupError(null);
          }}
          onLookup={(code, from) => void handleLookup(code, from)}
          lookingUp={lookingUp}
          lookupError={lookupError}
          lastScanRef={lastScanRef}
        />
      );
  }
}
