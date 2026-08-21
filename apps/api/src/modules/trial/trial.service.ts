/**
 * 試用申請核心邏輯：申請（防枚舉）、驗證即開通（原子）、重寄（節流）。
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

/** 是否已是任一租戶的 Agent（大小寫不敏感查一次）。 */
async function emailIsAgent(prisma: PrismaClient, email: string): Promise<boolean> {
  const agent = await prisma.agent.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  return !!agent;
}

/**
 * 申請試用。防枚舉：對外一律回相同結果，內部分流。
 * 回傳 { accepted } 供路由決定訊息（但訊息對所有情況相同）。
 */
export async function requestTrial(
  prisma: PrismaClient,
  input: { email: string; siteName: string; password: string; requestIp?: string },
): Promise<void> {
  const policy = await getTrialPolicy(prisma);
  if (!policy.enabled) {
    throw new AppError('Trial signup is currently closed', 'TRIAL_CLOSED', 403);
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

  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + policy.verifyTokenTtlHours * 3600_000);
  const passwordHash = await hashPassword(input.password);

  if (existing) {
    // pending（或 failed）→ 更新 token 寄新信（沿用申請時資料；重設節流計數不變）
    await prisma.trialSignup.update({
      where: { id: existing.id },
      data: {
        siteName: input.siteName,
        passwordHash,
        status: 'pending_verification',
        verifyTokenHash: hash,
        verifyTokenExpiresAt: expiresAt,
        verifySentCount: { increment: 1 },
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
        passwordHash,
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

/**
 * 驗證即開通（原子）。條件式 updateMany 消耗 token，與 provisionTenant 同 transaction。
 * 回傳站台資訊供成功頁。已開通的 token 重驗冪等回成功。
 */
export async function verifyAndProvision(
  prisma: PrismaClient,
  token: string,
): Promise<{ siteName: string; loginUrl: string; alreadyProvisioned: boolean }> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const policy = await getTrialPolicy(prisma);

  const plan = await prisma.plan.findUnique({ where: { slug: policy.planSlug }, select: { id: true } });
  if (!plan) throw new AppError('Trial plan not configured', 'TRIAL_MISCONFIGURED', 500);

  // token hash 保留到 provisioned（用 status 當消耗閘，非清 hash），
  // 讓 double-click 仍能反查到 row 回冪等成功。
  const signupRow = await prisma.trialSignup.findFirst({ where: { verifyTokenHash: hash } });

  if (!signupRow) {
    throw new AppError('驗證連結已失效或已使用', 'TRIAL_TOKEN_INVALID', 410);
  }
  const loginUrl = `${getConfig().WEB_BASE_URL}/login`;
  // double-click / 重按：已開通 → 冪等回成功頁
  if (signupRow.status === 'provisioned') {
    return { siteName: signupRow.siteName, loginUrl, alreadyProvisioned: true };
  }
  if (signupRow.status === 'failed') {
    throw new AppError('此 email 已被使用，無法開通', 'EMAIL_IN_USE', 409);
  }
  if (signupRow.verifyTokenExpiresAt && signupRow.verifyTokenExpiresAt < new Date()) {
    throw new AppError('驗證連結已過期，請重新申請或要求重寄', 'TRIAL_TOKEN_EXPIRED', 410);
  }

  const trialEndsAt = new Date(Date.now() + policy.durationDays * 86400_000);

  try {
    await prisma.$transaction(async (tx) => {
      // 原子閘：僅當仍 pending 時搶佔為 provisioning（併發雙擊只有一個 count=1）
      const claimed = await tx.trialSignup.updateMany({
        where: { id: signupRow.id, status: 'pending_verification' },
        data: { status: 'provisioning' },
      });
      if (claimed.count === 0) {
        throw new AppError('ALREADY_CLAIMED', 'ALREADY_CLAIMED', 409);
      }

      const { tenantId } = await provisionTenant(tx, {
        name: signupRow.siteName,
        planId: plan.id,
        admin: { email: signupRow.email, name: `${signupRow.siteName} Admin`, passwordHash: signupRow.passwordHash },
        trialEndsAt,
      });

      await tx.trialSignup.update({
        where: { id: signupRow.id },
        data: { status: 'provisioned', tenantId, provisionedAt: new Date() },
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
        return { siteName: fresh.siteName, loginUrl, alreadyProvisioned: true };
      }
      throw new AppError('開通處理中，請稍候再試', 'TRIAL_IN_PROGRESS', 409);
    }
    throw err;
  }

  // 開通成功後寄信（transaction 外，fire-and-forget）
  const expireDate = trialEndsAt.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
  void sendProvisionedEmail(signupRow.email, { siteName: signupRow.siteName, loginUrl, expireDate });

  return { siteName: signupRow.siteName, loginUrl, alreadyProvisioned: false };
}
