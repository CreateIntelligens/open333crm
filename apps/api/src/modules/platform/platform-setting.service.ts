/**
 * 平台全域設定（KV）。承載 trial.* 政策參數等。
 */
import type { PrismaClient, Prisma } from '@prisma/client';

export async function getPlatformSetting(
  prisma: PrismaClient,
  key: string,
): Promise<unknown | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row ? row.value : null;
}

export async function setPlatformSetting(
  prisma: PrismaClient,
  key: string,
  value: unknown,
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
}
