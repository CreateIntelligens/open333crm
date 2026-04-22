/**
 * WebChat Embed Code Generator — generates embeddable widget code.
 */

import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

export async function generateEmbedCode(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<{ html: string; channelId: string }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: CHANNEL_TYPE.WEBCHAT },
  });

  if (!channel) {
    throw new AppError('WebChat channel not found', 'NOT_FOUND', 404);
  }

  const fallbackApiOrigin = process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
  const fallbackApiBaseUrl = `${fallbackApiOrigin}/api/v1`;
  const apiBaseUrl = (() => {
    if (!channel.webhookUrl) return fallbackApiBaseUrl;
    const stripped = channel.webhookUrl.replace(/\/webhooks\/webchat\/.*$/, '');
    return stripped !== channel.webhookUrl ? stripped : fallbackApiBaseUrl;
  })();
  const widgetBaseUrl = process.env.WEB_BASE_URL || apiBaseUrl.replace(/\/api\/v1$/, '');

  const html = `<!-- Open333CRM WebChat Widget -->
<script>
  (function() {
    var w = window;
    w.Open333CRM = w.Open333CRM || {};
    w.Open333CRM.channelId = '${channelId}';
    w.Open333CRM.apiBaseUrl = '${apiBaseUrl}';
    var s = document.createElement('script');
    s.src = '${widgetBaseUrl}/webchat/widget.js';
    s.async = true;
    document.head.appendChild(s);
  })();
</script>`;

  return { html, channelId };
}
