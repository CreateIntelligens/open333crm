/**
 * 平台 superuser 登入驗證。與租戶 login 完全分離（不同表、不同 secret）。
 */
import type { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';

export async function platformLogin(prisma: PrismaClient, email: string, password: string) {
  const user = await prisma.platformUser.findUnique({ where: { email } });
  // 帳號不存在時仍跑一次 verifyPassword（對假 hash）以抹平時間差、避免帳號枚舉
  const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = await verifyPassword(password, hash);
  if (!user || !user.isActive || !ok) {
    throw new AppError('Invalid credentials', 'UNAUTHORIZED', 401);
  }
  await prisma.platformUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  return { id: user.id, email: user.email, name: user.name };
}
