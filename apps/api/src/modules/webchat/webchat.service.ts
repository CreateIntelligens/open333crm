import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';
import type { ChatboxThemeConfig } from '@open333crm/shared';
import { notFound } from '../../shared/messages/resource.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val);
}

export async function initVisitorSession(
  prisma: PrismaClient,
  channelId: string,
  visitorToken: string,
): Promise<{ visitorToken: string; greeting: string | null; theme: ChatboxThemeConfig }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, channelType: CHANNEL_TYPE.WEBCHAT, isActive: true },
  });

  if (!channel) throw new AppError(notFound('channel'), 'NOT_FOUND', 404);

  const settings = (channel.settings ?? {}) as Record<string, unknown>;
  const greeting = (settings.welcomeMessage as string | undefined) ?? null;
  const theme = getPublicWebchatTheme(settings);

  return { visitorToken, greeting, theme };
}

function getPublicWebchatTheme(settings: Record<string, unknown>): ChatboxThemeConfig {
  const theme = (
    settings.chatboxTheme && typeof settings.chatboxTheme === 'object' && !Array.isArray(settings.chatboxTheme)
      ? settings.chatboxTheme
      : {}
  ) as Record<string, unknown>;

  return {
    backgroundImageUrl: typeof theme.backgroundImageUrl === 'string' ? theme.backgroundImageUrl : null,
    backgroundSize: theme.backgroundSize === 'contain' ? 'contain' : 'cover',
    backgroundPosition: typeof theme.backgroundPosition === 'string' ? theme.backgroundPosition : 'center',
    foregroundColor: typeof theme.foregroundColor === 'string' ? theme.foregroundColor : undefined,
    accentColor: typeof theme.accentColor === 'string' ? theme.accentColor : undefined,
  };
}
