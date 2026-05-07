/**
 * BOT Inactivity Settings Service
 *
 * Manages the per-tenant threshold that triggers auto-close of BOT_HANDLED
 * conversations after a period of inactivity. The DB stores the threshold in
 * hours (`tenantSettings.botInactivityCloseHours`), but the front-end UI
 * exposes it in minutes — this service is the conversion layer.
 *
 * Note: minimum 60 minutes (= 1 hour). Anything smaller is rounded up to 1h.
 */

import type { PrismaClient } from '@prisma/client';

export interface BotInactivitySettings {
  botInactivityMinutes: number;
}

const MIN_HOURS = 1;

export async function getBotInactivitySettings(
  prisma: PrismaClient,
  tenantId: string,
): Promise<BotInactivitySettings> {
  let settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (!settings) {
    settings = await prisma.tenantSettings.create({ data: { tenantId } });
  }
  return { botInactivityMinutes: settings.botInactivityCloseHours * 60 };
}

export async function updateBotInactivitySettings(
  prisma: PrismaClient,
  tenantId: string,
  patch: { botInactivityMinutes: number },
): Promise<BotInactivitySettings> {
  const hours = Math.max(MIN_HOURS, Math.round(patch.botInactivityMinutes / 60));

  const updated = await prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, botInactivityCloseHours: hours },
    update: { botInactivityCloseHours: hours },
  });

  return { botInactivityMinutes: updated.botInactivityCloseHours * 60 };
}
