import { FastifyInstance } from 'fastify';
import { getPlugin } from '@open333crm/channel-plugins';
import { inboundRouterService } from '../services/inbound-router.js';

export default async function webhookRoutes(app: FastifyInstance) {
  
  // ── Telegram Webhook ────────────────────────
  app.post('/telegram/:id', async (req, reply) => {
    const { id: channelId } = req.params as { id: string };
    const plugin = getPlugin('TELEGRAM');
    
    // 1. Verify (Mocked secret)
    // In a real app, retrieve secret from channel credentials
    // const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    
    const messages = await plugin.parseWebhook(
      Buffer.from(JSON.stringify(req.body)),
      req.headers as Record<string, string>
    );

    for (const msg of messages) {
      msg.channelId = channelId;
      // 2. Resolve Team
      const routing = await inboundRouterService.resolveTeam(msg);
      console.log(`[Webhook] Routed Telegram message to team: ${routing.teamId} (${routing.reason})`);
      
      // 3. Emit event or save to DB
      // eventBus.emit('message:inbound', { message: msg, teamId: routing.teamId });
    }

    return { ok: true };
  });

  // ── Threads / Instagram Webhook ─────────────
  app.post('/threads/:id', async (req, reply) => {
    const { id: channelId } = req.params as { id: string };
    const plugin = getPlugin('THREADS');

    const messages = await plugin.parseWebhook(
      Buffer.from(JSON.stringify(req.body)),
      req.headers as Record<string, string>
    );

    for (const msg of messages) {
      msg.channelId = channelId;
      const routing = await inboundRouterService.resolveTeam(msg);
      console.log(`[Webhook] Routed Threads message to team: ${routing.teamId} (${routing.reason})`);
    }

    return { ok: true };
  });

}
