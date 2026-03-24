import { FastifyInstance } from 'fastify';
import { getPlugin } from '@open333crm/channel-plugins';
import { inboundRouterService } from '../services/inbound-router.js';
import { LicenseService } from '@open333crm/core';
// import { prisma } from '@open333crm/database'; // Assuming we have prisma attached to app or imported

export default async function webhookRoutes(app: FastifyInstance) {
  
  // ── Generic Webhook Challenge (GET) ──────────
  // Primarily used by Facebook Messenger for `hub.verify_token` checking
  app.get('/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const query = req.query as any;

    // Check if it's a FB challenge
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token']) {
      // Typically we'd load the channel from DB and check the verify token matches channel credentials
      // const channel = await prisma.channel.findUnique({ where: { id: channelId } });
      const verifyToken = query['hub.verify_token'];
      const challenge = query['hub.challenge'];
      
      // For now, accept and return the challenge directly
      reply.status(200).send(challenge);
      return;
    }

    reply.status(400).send('Bad Request');
  });

  // ── Generic Webhook Payload (POST) ───────────
  app.post('/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const headers = req.headers as Record<string, string>;
    
    // 1. Fetch channel from DB directly
    // const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    // if (!channel || !channel.isActive) return reply.status(404).send('Channel not found or inactive');
    
    // Mock channel for execution
    const channel = {
      id: channelId,
      channelType: 'FB', // Mock: dynamic in reality based on channel.type
      credentialsEncrypted: 'mocked-secret'
    } as any; 

    // 2. LicenseService Feature Flag Check
    const isEnabled = await LicenseService.getInstance().isChannelEnabled(channel.channelType);
    if (!isEnabled) {
      app.log.warn(`[Webhook] Rejected payload for ${channelId}: Channel Type ${channel.channelType} is disabled by License.`);
      return reply.status(403).send({ error: 'Channel Feature Disabled.' });
    }

    // 3. Plugin Verification & Parsing
    try {
      const plugin = getPlugin(channel.channelType as any);
      
      const isValid = plugin.verifySignature(
        Buffer.from(JSON.stringify(req.body)),
        headers,
        channel.credentialsEncrypted
      );

      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid Webhook Signature' });
      }

      const messages = await plugin.parseWebhook(
        Buffer.from(JSON.stringify(req.body)),
        headers
      );

      // 4. Inbound Routing mapping
      for (const msg of messages) {
        msg.channelId = channel.id;
        const routing = await inboundRouterService.resolveTeam(msg);
        app.log.info(`[Webhook] Routed ${channel.channelType} message to team: ${routing.teamId} (${routing.reason})`);
        
        // 5. Emit to EventBus
        // eventBus.publish('message.inbound', { message: msg, teamId: routing.teamId });
      }

      return { ok: true };
    } catch (err: any) {
      app.log.error(`[Webhook] Error processing payload: ${err.message}`);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

}
