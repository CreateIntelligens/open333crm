/**
 * 平台帳號密碼管理：已登入自助改密碼、忘記密碼申請/重設（時效 token、單次使用、防枚舉）。
 */
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';
import { normalizeEmail } from '../../shared/utils/email.js';
import { sendPlatformPasswordResetEmail } from './platform-user-emails.js';

const RESET_TOKEN_TTL_MINUTES = 60;

function newToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

function resetUrl(token: string): string {
  return `${getConfig().WEB_BASE_URL}/admin/reset-password?token=${token}`;
}

/** 已登入平台管理員自助改密碼，需驗證舊密碼。改密碼成功即清除 mustChangePassword（若原為 true）。 */
export async function changeOwnPassword(
  prisma: PrismaClient,
  userId: string,
  input: { oldPassword: string; newPassword: string },
): Promise<void> {
  const user = await prisma.platformUser.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw new AppError('Platform user not found', 'NOT_FOUND', 404);

  const ok = await verifyPassword(input.oldPassword, user.passwordHash);
  if (!ok) throw new AppError('Old password is incorrect', 'UNAUTHORIZED', 401);

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.platformUser.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
}

/**
 * 申請忘記密碼重設信。防枚舉：無論 email 是否存在/啟用，皆回相同成功結果；
 * 只有存在且啟用中的帳號才真的產生 token 並寄信。
 */
export async function requestPasswordReset(prisma: PrismaClient, email: string): Promise<void> {
  const user = await prisma.platformUser.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) return; // 靜默，不洩漏帳號存在與否

  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);
  await prisma.platformUser.update({
    where: { id: user.id },
    data: { resetTokenHash: hash, resetTokenExpiresAt: expiresAt },
  });

  await sendPlatformPasswordResetEmail(email, {
    resetUrl: resetUrl(token),
    ttlMinutes: RESET_TOKEN_TTL_MINUTES,
  });
}

/**
 * 用重設信中的 token 設定新密碼。驗證 token 雜湊比對且未過期；
 * 成功後立即清空 token 欄位（單次使用）。強度不足時保留 token 有效，允許重新提交。
 */
export async function resetPasswordWithToken(
  prisma: PrismaClient,
  token: string,
  newPassword: string,
): Promise<void> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await prisma.platformUser.findUnique({
    where: { resetTokenHash: hash },
    select: { id: true, resetTokenExpiresAt: true },
  });
  if (!user) throw new AppError('重設連結無效或已使用', 'RESET_TOKEN_INVALID', 410);
  if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    throw new AppError('重設連結已過期，請重新申請', 'RESET_TOKEN_EXPIRED', 410);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.platformUser.update({
    where: { id: user.id },
    data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null, mustChangePassword: false },
  });
}
