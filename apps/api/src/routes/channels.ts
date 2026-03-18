import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { licenseService } from '../services/license.js';
import { channelTeamAccessService } from '../services/channel-team-access.js';

export default async function channelRoutes(app: FastifyInstance) {
  
  // ── Channel Creation (Q1, Q4) ───────────────
  
  const createTelegramSchema = z.object({
    displayName: z.string(),
    botToken: z.string(),
    webhookSecret: z.string(),
    defaultTeamId: z.string().optional()
  });

  app.post('/telegram', async (req, reply) => {
    const body = createTelegramSchema.parse(req.body);
    
    // 1. Check License (maxCount)
    const maxCount = licenseService.getChannelMaxCount('TELEGRAM');
    const currentCount = 0; // In a real app: await prisma.channel.count({ where: { channelType: 'TELEGRAM' } })
    
    if (currentCount >= maxCount) {
      return reply.code(402).send({ 
        code: 'CHANNEL_LIMIT_EXCEEDED',
        message: 'Telegram 渠道數量已達授權上限' 
      });
    }

    // 2. Create Channel (Mock)
    const channelId = crypto.randomUUID();
    console.log(`[API] Created Telegram Channel: ${body.displayName} (${channelId})`);

    // 3. Auto-grant access to defaultTeamId (Task 4.2)
    if (body.defaultTeamId) {
      await channelTeamAccessService.grantAccess({
        channelId,
        teamId: body.defaultTeamId,
        accessLevel: 'full'
      });
    }

    return { id: channelId, status: 'created' };
  });

  // ── Channel Team Authorization (Task 4.7, 4.8) ──

  const grantAccessSchema = z.object({
    teamId: z.string(),
    accessLevel: z.enum(['full', 'reply_only', 'read_only'])
  });

  app.post('/:id/teams', async (req, reply) => {
    const { id: channelId } = req.params as { id: string };
    const body = grantAccessSchema.parse(req.body);

    const access = await channelTeamAccessService.grantAccess({
      channelId,
      teamId: body.teamId,
      accessLevel: body.accessLevel
    });

    return access;
  });

  app.get('/:id/teams', async (req) => {
    const { id: channelId } = req.params as { id: string };
    return await channelTeamAccessService.listTeamsForChannel(channelId);
  });

  app.delete('/:id/teams/:teamId', async (req) => {
    const { id: channelId, teamId } = req.params as { id: string, teamId: string };
    const success = await channelTeamAccessService.revokeAccess(channelId, teamId);
    return { success };
  });

}
