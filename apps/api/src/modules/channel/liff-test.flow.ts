/**
 * 測試 LIFF 設定（change add-liff-config-test）：產生測試連結、手機回報結果、後台查詢結果。
 *
 * 測試連結與結果存在 Redis，10 分鐘過期（design D2）；向 LINE 驗證 ID token 不放在交易內。
 */
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { PrismaClient } from '@prisma/client';
import { inTenant } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import type { LineIdTokenCheck } from '../coupon/line-id-token.js';
import { isLineIdentityOfChannel, readLiffTestTarget, recordLiffTestSuccess } from './liff-test.service.js';

export interface LiffTestDeps {
  prisma: PrismaClient;
  store: BindingStore;
  checkIdToken: (idToken: string, clientId: string) => Promise<LineIdTokenCheck>;
  now?: () => number;
}

export const LIFF_TEST_TTL_MS = 10 * 60 * 1000;

/** 手機端回報的失敗：只有手機知道 LIFF 有沒有啟動、有沒有給 ID token（design D5） */
export const LIFF_TEST_CLIENT_FAILURES = ['init_failed', 'no_id_token'] as const;
export type LiffTestClientFailure = (typeof LIFF_TEST_CLIENT_FAILURES)[number];

export type LiffTestStatus = 'verified' | 'not_a_friend' | 'id_token_rejected' | 'line_unreachable' | LiffTestClientFailure;

export const LIFF_TEST_MESSAGES: Record<LiffTestStatus, string> = {
  verified: '設定正確：LINE 顧客開啟優惠券時，會用 LINE 帳號自動驗證身分。',
  not_a_friend:
    'LINE 登入成功，但這個 LINE 帳號不在這個官方帳號的聯絡人裡。請先加官方帳號好友並傳一則訊息，再測一次。' +
    '如果已經是好友，代表 LINE Login channel 和官方帳號不在同一個 Provider，顧客開啟優惠券時會無法自動驗證，' +
    '要在官方帳號的 Provider 底下重建 LINE Login channel 與 LIFF App。',
  id_token_rejected:
    'LINE 不接受這次登入的 ID token：LINE Login Channel ID 和 LIFF App 不屬於同一個 channel。' +
    '請填建立這個 LIFF App 的 LINE Login channel 的 Channel ID。',
  line_unreachable: '暫時連不上 LINE，請稍後再測一次。',
  init_failed: 'LIFF 無法啟動。請確認 LIFF App ID 正確，而且 LIFF App 的 Endpoint URL 指向本系統的 /liff/redirect。',
  no_id_token: 'LIFF 沒有提供 ID token。請在 LIFF App 的 Scope 勾選 openid，再測一次。',
};

export interface LiffTestOutcome {
  status: LiffTestStatus;
  message: string;
}

interface StoredTest {
  tenantId: string;
  channelId: string;
  liffId: string;
  loginChannelId: string;
}

const testKey = (testId: string) => `channel:liff-test:${testId}`;
const resultKey = (testId: string) => `channel:liff-test-result:${testId}`;
const nowOf = (deps: LiffTestDeps) => (deps.now ?? Date.now)();

async function readTest(deps: LiffTestDeps, testId: string): Promise<StoredTest | null> {
  const raw = await deps.store.get(testKey(testId));
  return raw ? (JSON.parse(raw) as StoredTest) : null;
}

/** 產生測試連結。測試的是產生當下存檔的設定值 */
export async function startLiffTestFlow(deps: LiffTestDeps, tenantId: string, channelId: string) {
  const target = await inTenant(deps.prisma, tenantId, (ctx) => readLiffTestTarget(ctx, channelId));
  if (target.kind === 'not_found') throw new AppError(notFound('channel'), 'NOT_FOUND', 404);
  if (target.kind === 'not_configured') {
    throw new AppError('請先填好並儲存 LIFF App ID 與 LINE Login Channel ID，再測試', 'LIFF_NOT_CONFIGURED', 409);
  }

  const testId = randomBytes(32).toString('base64url');
  const { liffId, loginChannelId } = target.liff;
  const stored: StoredTest = { tenantId, channelId, liffId, loginChannelId };
  await deps.store.set(testKey(testId), JSON.stringify(stored), 'PX', LIFF_TEST_TTL_MS, 'NX');

  const params = new URLSearchParams({ lt: testId, lid: liffId });
  const testUrl = `https://liff.line.me/${encodeURIComponent(liffId)}?${params.toString()}`;
  const qrCode = await QRCode.toDataURL(testUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return { testId, testUrl, qrCode, expiresAt: new Date(nowOf(deps) + LIFF_TEST_TTL_MS).toISOString() };
}

export type LiffTestReport = { testId: string; idToken: string } | { testId: string; failure: LiffTestClientFailure };

/** 手機回報。測試連結不存在或過期回 null */
export async function reportLiffTestFlow(deps: LiffTestDeps, input: LiffTestReport): Promise<LiffTestOutcome | null> {
  const test = await readTest(deps, input.testId);
  if (!test) return null;

  let status: LiffTestStatus;
  if ('failure' in input) {
    status = input.failure;
  } else {
    const checked = await deps.checkIdToken(input.idToken, test.loginChannelId);
    if (checked.result === 'rejected') status = 'id_token_rejected';
    else if (checked.result === 'unreachable') status = 'line_unreachable';
    else {
      const verifiedAt = new Date(nowOf(deps)).toISOString();
      status = await inTenant(deps.prisma, test.tenantId, async (ctx) => {
        if (!(await isLineIdentityOfChannel(ctx, test.channelId, checked.sub))) return 'not_a_friend';
        await recordLiffTestSuccess(ctx, test.channelId, { verifiedAt, liffId: test.liffId, loginChannelId: test.loginChannelId });
        return 'verified';
      });
    }
  }

  const outcome: LiffTestOutcome = { status, message: LIFF_TEST_MESSAGES[status] };
  // 結果跟測試連結同時過期；同一條連結重測時，後一次結果覆蓋前一次
  const remaining = await deps.store.pttl(testKey(input.testId));
  if (remaining > 0) {
    const value = JSON.stringify(outcome);
    const replaced = await deps.store.set(resultKey(input.testId), value, 'PX', remaining, 'XX');
    if (!replaced) await deps.store.set(resultKey(input.testId), value, 'PX', remaining, 'NX');
  }
  return outcome;
}

export type LiffTestResult = { status: 'pending' } | { status: 'expired' } | LiffTestOutcome;

/** 後台查詢結果。testId 不屬於這個租戶的這個渠道時回 404 */
export async function getLiffTestResultFlow(
  deps: LiffTestDeps,
  tenantId: string,
  channelId: string,
  testId: string,
): Promise<LiffTestResult> {
  const test = await readTest(deps, testId);
  if (!test) return { status: 'expired' };
  if (test.tenantId !== tenantId || test.channelId !== channelId) {
    throw new AppError('找不到這次測試', 'NOT_FOUND', 404);
  }
  const raw = await deps.store.get(resultKey(testId));
  return raw ? (JSON.parse(raw) as LiffTestOutcome) : { status: 'pending' };
}
