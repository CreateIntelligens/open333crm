/**
 * WebChat Embed Code Generator — generates embeddable widget code.
 */

import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';

export async function generateEmbedCode(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<{ html: string; channelId: string }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'WEBCHAT' },
  });

  if (!channel) {
    throw new AppError('WebChat channel not found', 'NOT_FOUND', 404);
  }

  const fallbackUrl = process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
  const apiUrl = (() => {
    if (!channel.webhookUrl) return fallbackUrl;
    const stripped = channel.webhookUrl.replace(/\/api\/v1\/webhooks\/webchat\/.*$/, '');
    // If nothing was stripped, the webhookUrl doesn't match the expected pattern — fall back
    return stripped !== channel.webhookUrl ? stripped : fallbackUrl;
  })();

  const html = `<!-- Open333CRM WebChat Widget -->
<script>
  (function() {
    var w = window;
    w.Open333CRM = w.Open333CRM || {};
    w.Open333CRM.channelId = '${channelId}';
    w.Open333CRM.apiUrl = '${apiUrl}';
    var s = document.createElement('script');
    s.src = '${apiUrl}/webchat/widget.js';
    s.async = true;
    document.head.appendChild(s);
  })();
</script>`;

  return { html, channelId };
}
