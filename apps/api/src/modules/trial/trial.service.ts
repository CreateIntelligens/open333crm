/**
 * 試用申請核心邏輯：申請（防枚舉）、重寄（節流）、驗證頁查詢連結、設定密碼並開通（原子）。
 *
 * 申請時不收密碼（AUDIT TRIAL-05）：管理員密碼只能由打開驗證信連結的人設定，
 * 所以知道別人 email 的人無法替對方決定密碼。
 */
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { hashPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';
import { normalizeEmail } from './email-normalizer.js';
import { getTrialPolicy } from './trial-policy.service.js';
import { provisionTenant } from '../platform/platform-tenant.service.js';
import { sendVerifyEmail, sendProvisionedEmail } from './trial-emails.js';

const RESEND_COOLDOWN_MS = 60_000;
const RESEND_MAX = 5;

function newToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

function verifyUrl(token: string): string {
  return `${getConfig().WEB_BASE_URL}/trial/verify?token=${token}`;
}

/**
 * 是否已是任一租戶的 Agent。
 *
 * 以「正規化 email」比對（去 gmail 點/+tag），避免 gmail 別名（foo.bar 與 foobar）
 * 繞過此檢查申請到第二個試用租戶。因 Agent 表未存 normalized 欄位，無法在 SQL 端
 * 正規化比對，故先以同網域候選撈出（gmail 別名一定同網域），再於應用層逐一比對
 * 正規化值。候選集受單一網域限制、非全表掃描，量級可接受。
 */
async function emailIsAgent(prisma: PrismaClient, email: string): Promise<boolean> {
  const { normalized } = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  const canonicalDomain = at >= 0 ? normalized.slice(at + 1) : '';

  // 撈同網域候選（gmail 與 googlemail 皆正規化為 gmail.com，兩者都要撈）。
  const domainFilters =
    canonicalDomain === 'gmail.com'
      ? [{ email: { endsWith: '@gmail.com', mode: 'insensitive' as const } }, { email: { endsWith: '@googlemail.com', mode: 'insensitive' as const } }]
      : [{ email: { endsWith: `@${canonicalDomain}`, mode: 'insensitive' as const } }];

  const candidates = await prisma.agent.findMany({
    where: { OR: domainFilters },
    select: { email: true },
  });

  return candidates.some((a) => normalizeEmail(a.email).normalized === normalized);
}

/**
 * 申請試用。防枚舉：對外一律回相同結果，內部分流。
 *
 * 待驗證的申請再送一次時不改任何申請資料，只交給 resendTrial() 依節流重寄（AUDIT TRIAL-05、TRIAL-06）。
 */
export async function requestTrial(
  prisma: PrismaClient,
  input: { email: string; siteName: string; requestIp?: string },
): Promise<void> {
  const policy = await getTrialPolicy(prisma);
  if (!policy.enabled) {
    throw new AppError('目前暫停開放試用申請', 'TRIAL_CLOSED', 403);
  }

  const { email, normalized } = normalizeEmail(input.email);
  const existing = await prisma.trialSignup.findUnique({ where: { emailNormalized: normalized } });

  // 已開通過（含到期）→ 靜默，不建新 row、不寄信
  if (existing?.status === 'provisioned') {
    logger.info(`[Trial] request for already-provisioned email (silent)`);
    return;
  }
  // 已是某租戶 Agent → 靜默
  if (await emailIsAgent(prisma, email)) {
    logger.info(`[Trial] request for existing agent email (silent)`);
    return;
  }

  // 待驗證（或開通處理中）→ 不覆寫，依重寄節流處理。重寄寄到申請時的 email，不是這次送的別名寫法。
  if (existing && existing.status !== 'failed') {
    await resendTrial(prisma, existing.email);
    return;
  }

  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + policy.verifyTokenTtlHours * 3600_000);

  if (existing) {
    // failed（email 衝突或平台作廢）→ 視同重新申請；已是 Agent 的情況上面已靜默擋掉
    await prisma.trialSignup.update({
      where: { id: existing.id },
      data: {
        siteName: input.siteName,
        status: 'pending_verification',
        verifyTokenHash: hash,
        verifyTokenExpiresAt: expiresAt,
        verifySentCount: 1,
        lastVerifySentAt: new Date(),
        failureReason: null,
      },
    });
  } else {
    await prisma.trialSignup.create({
      data: {
        email,
        emailNormalized: normalized,
        siteName: input.siteName,
        verifyTokenHash: hash,
        verifyTokenExpiresAt: expiresAt,
        verifySentCount: 1,
        lastVerifySentAt: new Date(),
        requestIp: input.requestIp,
      },
    });
  }

  await sendVerifyEmail(email, { siteName: input.siteName, verifyUrl: verifyUrl(token), ttlHours: policy.verifyTokenTtlHours });
}

/** 重寄驗證信（節流）。防枚舉：一律成功回應，內部依狀態/節流決定是否真寄。 */
export async function resendTrial(
  prisma: PrismaClient,
  rawEmail: string,
  opts: { bypassThrottle?: boolean } = {},
): Promise<void> {
  const { email, normalized } = normalizeEmail(rawEmail);
  const row = await prisma.trialSignup.findUnique({ where: { emailNormalized: normalized } });
  if (!row || row.status !== 'pending_verification') return; // 靜默

  // 節流：冷卻 + 次數上限（平台管理員手動重寄時繞過，避免使用者達上限後管理員操作靜默失敗）
  if (!opts.bypassThrottle) {
    if (row.lastVerifySentAt && Date.now() - row.lastVerifySentAt.getTime() < RESEND_COOLDOWN_MS) return;
    if (row.verifySentCount >= RESEND_MAX) return;
  }

  const policy = await getTrialPolicy(prisma);
  const { token, hash } = newToken();
  await prisma.trialSignup.update({
    where: { id: row.id },
    data: {
      verifyTokenHash: hash,
      verifyTokenExpiresAt: new Date(Date.now() + policy.verifyTokenTtlHours * 3600_000),
      verifySentCount: { increment: 1 },
      lastVerifySentAt: new Date(),
    },
  });
  await sendVerifyEmail(email, { siteName: row.siteName, verifyUrl: verifyUrl(token), ttlHours: policy.verifyTokenTtlHours });
}

const loginUrl = () => `${getConfig().WEB_BASE_URL}/login`;

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * 依 token 找申請並檢查能否開通。已開通回 row（由呼叫端決定冪等回應）；
 * 無效、作廢（failed）、過期都丟錯，不改任何資料。
 */
async function findSignupByToken(prisma: PrismaClient, token: string) {
  // token hash 保留到 provisioned（用 status 當消耗閘，非清 hash），
  // 讓 double-click 仍能反查到 row 回冪等成功。
  const row = await prisma.trialSignup.findFirst({ where: { verifyTokenHash: hashToken(token) } });
  if (!row) {
    throw new AppError('驗證連結已失效或已使用', 'TRIAL_TOKEN_INVALID', 410);
  }
  if (row.status === 'provisioned') return row;
  if (row.status === 'failed') {
    throw new AppError('此 email 已被使用，無法開通', 'EMAIL_IN_USE', 409);
  }
  if (row.verifyTokenExpiresAt && row.verifyTokenExpiresAt < new Date()) {
    throw new AppError('驗證連結已過期，請重新申請或要求重寄', 'TRIAL_TOKEN_EXPIRED', 410);
  }
  return row;
}

/**
 * 驗證頁查詢連結狀態。只讀：不消耗 token、不開通。
 * email 只回給持有 token 的人（token 只寄到該信箱），讓本人確認是哪個帳號。
 */
export async function getVerifyStatus(
  prisma: PrismaClient,
  token: string,
): Promise<{ email: string; siteName: string; status: 'pending' | 'provisioned'; loginUrl: string }> {
  const row = await findSignupByToken(prisma, token);
  return {
    email: row.email,
    siteName: row.siteName,
    status: row.status === 'provisioned' ? 'provisioned' : 'pending',
    loginUrl: loginUrl(),
  };
}

/**
 * 設定密碼並開通（原子）。條件式 updateMany 消耗 token，與 provisionTenant 同 transaction。
 * 管理員密碼用這次送出的密碼；站台名稱未送時沿用申請時的名稱。
 * 已開通的 token 再送一次冪等回成功，不改密碼。
 */
export async function verifyAndProvision(
  prisma: PrismaClient,
  input: { token: string; password: string; siteName?: string },
): Promise<{ siteName: string; loginUrl: string; alreadyProvisioned: boolean }> {
  const policy = await getTrialPolicy(prisma);

  const plan = await prisma.plan.findUnique({ where: { slug: policy.planSlug }, select: { id: true } });
  if (!plan) throw new AppError('尚未設定試用方案，請聯繫管理員', 'TRIAL_MISCONFIGURED', 500);

  const signupRow = await findSignupByToken(prisma, input.token);
  // double-click / 重按：已開通 → 冪等回成功頁
  if (signupRow.status === 'provisioned') {
    return { siteName: signupRow.siteName, loginUrl: loginUrl(), alreadyProvisioned: true };
  }

  const siteName = input.siteName?.trim() || signupRow.siteName;
  const passwordHash = await hashPassword(input.password);
  const trialEndsAt = new Date(Date.now() + policy.durationDays * 86400_000);

  try {
    await prisma.$transaction(async (tx) => {
      // 原子閘：僅當仍 pending 且 token 未被重寄換掉時搶佔為 provisioning（併發雙擊只有一個 count=1）
      const claimed = await tx.trialSignup.updateMany({
        where: { id: signupRow.id, status: 'pending_verification', verifyTokenHash: hashToken(input.token) },
        data: { status: 'provisioning' },
      });
      if (claimed.count === 0) {
        throw new AppError('此試用方案已經領取過了', 'ALREADY_CLAIMED', 409);
      }

      const { tenantId } = await provisionTenant(tx, {
        name: siteName,
        planId: plan.id,
        admin: { email: signupRow.email, name: `${siteName} Admin`, passwordHash },
        trialEndsAt,
      });

      await tx.trialSignup.update({
        where: { id: signupRow.id },
        data: { status: 'provisioned', siteName, tenantId, provisionedAt: new Date() },
      });
    });
  } catch (err) {
    // email 被其他租戶建走（P2002）→ 標 failed。狀態回滾（transaction 已 rollback provisioning）後再標
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      await prisma.trialSignup.update({
        where: { id: signupRow.id },
        data: { status: 'failed', failureReason: 'email already in use' },
      });
      throw new AppError('此 email 已被使用，無法開通', 'EMAIL_IN_USE', 409);
    }
    // 併發：另一請求已搶佔 → 若對方已開通則冪等回成功，否則請稍後
    if (err instanceof AppError && err.code === 'ALREADY_CLAIMED') {
      const fresh = await prisma.trialSignup.findUnique({ where: { id: signupRow.id } });
      if (fresh?.status === 'provisioned') {
        return { siteName: fresh.siteName, loginUrl: loginUrl(), alreadyProvisioned: true };
      }
      // 讀取之後被重寄換掉 token：這條連結已失效
      if (fresh && fresh.verifyTokenHash !== hashToken(input.token)) {
        throw new AppError('驗證連結已失效或已使用', 'TRIAL_TOKEN_INVALID', 410);
      }
      throw new AppError('開通處理中，請稍候再試', 'TRIAL_IN_PROGRESS', 409);
    }
    throw err;
  }

  // 開通成功後寄信（transaction 外，fire-and-forget）
  const expireDate = trialEndsAt.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
  void sendProvisionedEmail(signupRow.email, { siteName, loginUrl: loginUrl(), expireDate });

  return { siteName, loginUrl: loginUrl(), alreadyProvisioned: false };
}
