/**
 * 平台帳號（PlatformUser）自身的生命週期管理：開通、列表、編輯、停用/啟用、重寄開通信、稽核查詢。
 * 不同於 platform-tenant.service.ts（管租戶）；本檔管的是平台管理員自己這批帳號。
 */
import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../../config/env.js';
import { hashPassword } from '../../shared/utils/password.js';
import { generateTempPassword } from '../../shared/utils/temp-password.js';
import { AppError } from '../../shared/utils/response.js';
import { sendPlatformUserProvisionedEmail } from './platform-user-emails.js';

const PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listPlatformUsers(prisma: PrismaClient) {
  return prisma.platformUser.findMany({
    select: PUBLIC_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPlatformUser(prisma: PrismaClient, id: string) {
  const user = await prisma.platformUser.findUnique({ where: { id }, select: PUBLIC_SELECT });
  if (!user) throw new AppError('Platform user not found', 'NOT_FOUND', 404);
  return user;
}

/**
 * 開通新平台帳號：email 全域唯一、密碼由系統隨機產生（呼叫端不輸入密碼）。
 * 新帳號標記 mustChangePassword=true，開通信帶明文臨時密碼，首次登入後須強制改密碼。
 */
export async function createPlatformUser(
  prisma: PrismaClient,
  input: { email: string; name: string },
): Promise<{ id: string; email: string; name: string; isActive: boolean; loginUrl: string }> {
  const existing = await prisma.platformUser.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new AppError('Email already in use', 'CONFLICT', 409);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.platformUser.create({
    data: { email: input.email, name: input.name, passwordHash, mustChangePassword: true },
    select: { id: true, email: true, name: true, isActive: true },
  });

  const loginUrl = `${getConfig().WEB_BASE_URL}/admin/login`;
  void sendPlatformUserProvisionedEmail(input.email, { name: input.name, loginUrl, tempPassword });

  return { ...user, loginUrl };
}

/** 編輯平台帳號 name/email；email 變更需重新檢查全域唯一。 */
export async function updatePlatformUser(
  prisma: PrismaClient,
  id: string,
  input: { name?: string; email?: string },
) {
  const existing = await prisma.platformUser.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!existing) throw new AppError('Platform user not found', 'NOT_FOUND', 404);

  if (input.email !== undefined && input.email !== existing.email) {
    const dup = await prisma.platformUser.findUnique({ where: { email: input.email }, select: { id: true } });
    if (dup) throw new AppError('Email already in use', 'CONFLICT', 409);
  }

  return prisma.platformUser.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    },
    select: PUBLIC_SELECT,
  });
}

/**
 * 停用/啟用平台帳號。防呆：
 * - 不可停用自己（callerId 為目前登入的平台帳號 id）
 * - 不可讓「啟用中平台帳號」歸零
 */
export async function setPlatformUserActive(
  prisma: PrismaClient,
  id: string,
  isActive: boolean,
  callerId: string,
) {
  const existing = await prisma.platformUser.findUnique({ where: { id }, select: { id: true, isActive: true } });
  if (!existing) throw new AppError('Platform user not found', 'NOT_FOUND', 404);

  if (!isActive && id === callerId) {
    throw new AppError('Cannot disable your own account', 'CANNOT_DISABLE_SELF', 400);
  }

  // 「啟用中帳號歸零」防呆必須把 count 檢查與 update 放進同一交易，並用 Serializable
  // 隔離級別；否則兩位管理者同時停用最後兩組帳號時，兩邊的 count 都會讀到 2 而各自放行，
  // 導致啟用帳號歸零、沒人能登入平台後台（bot review CM-... race condition）。
  return prisma.$transaction(
    async (tx) => {
      if (!isActive && existing.isActive) {
        const activeCount = await tx.platformUser.count({ where: { isActive: true } });
        if (activeCount <= 1) {
          throw new AppError('At least one active platform user must remain', 'PLATFORM_LAST_USER_ACTIVE', 400);
        }
      }
      return tx.platformUser.update({
        where: { id },
        data: { isActive },
        select: PUBLIC_SELECT,
      });
    },
    { isolationLevel: 'Serializable' },
  );
}

/** 重寄開通信：產生新的臨時密碼取代舊值（舊臨時密碼隨即失效），重新標記 mustChangePassword=true。 */
export async function resendPlatformUserWelcomeEmail(prisma: PrismaClient, id: string) {
  const user = await prisma.platformUser.findUnique({ where: { id }, select: { email: true, name: true } });
  if (!user) throw new AppError('Platform user not found', 'NOT_FOUND', 404);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.platformUser.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });

  const loginUrl = `${getConfig().WEB_BASE_URL}/admin/login`;
  await sendPlatformUserProvisionedEmail(user.email, { name: user.name, loginUrl, tempPassword });
  return { ok: true, email: user.email };
}

/** 該平台帳號相關的稽核記錄：自己執行的操作（platformUserId）＋以自己為對象的操作（targetType=platform_user, targetId）。 */
export async function getPlatformUserAuditLogs(prisma: PrismaClient, id: string) {
  const existing = await prisma.platformUser.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('Platform user not found', 'NOT_FOUND', 404);

  return prisma.platformAuditLog.findMany({
    where: {
      OR: [{ platformUserId: id }, { targetType: 'platform_user', targetId: id }],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
