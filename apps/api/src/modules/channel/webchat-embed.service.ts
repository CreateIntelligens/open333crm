/**
 * WebChat Embed Code Generator — generates embeddable widget code.
 */

import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { ensureChannelPublicKey } from './channel.service.js';

export async function generateEmbedCode(
  prisma: TenantDb,
  channelId: string,
  tenantId: string,
): Promise<{ html: string; channelId: string; channelPublicKey: string }> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: CHANNEL_TYPE.WEBCHAT },
  });

  if (!channel) {
    throw new AppError('WebChat channel not found', 'NOT_FOUND', 404);
  }

  const { publicKey: channelPublicKey } = channel.publicKey
    ? { publicKey: channel.publicKey }
    : await ensureChannelPublicKey(prisma, channelId, tenantId);

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
    w.Open333CRM.channelPublicKey = '${channelPublicKey}';
    w.Open333CRM.apiBaseUrl = '${apiBaseUrl}';
    var s = document.createElement('script');
    s.src = '${widgetBaseUrl}/webchat/widget.js';
    s.async = true;
    document.head.appendChild(s);
  })();
</script>`;

  return { html, channelId, channelPublicKey };
}
