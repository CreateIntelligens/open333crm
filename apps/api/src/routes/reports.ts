import { FastifyInstance } from 'fastify';
import { z } from 'zod';

export default async function reportRoutes(app: FastifyInstance) {
  
  // ── Channel Usage Report (Task 5.2) ─────────

  const usageQuerySchema = z.object({
    teamId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    channelType: z.string().optional()
  });

  app.get('/channel-usage', async (req) => {
    const query = usageQuerySchema.parse(req.query);
    
    console.log(`[API] Generating channel usage report for:`, query);

    // Mock response
    return {
      summary: {
        totalOutbound: 156,
        totalInbound: 432,
        totalFees: 15.6,
        currency: 'USD'
      },
      details: [
        {
          date: '2026-03-18',
          channelType: 'TELEGRAM',
          teamId: query.teamId ?? 'team_sales',
          outboundCount: 10,
          inboundCount: 25,
          fee: 1.0
        },
        {
          date: '2026-03-18',
          channelType: 'LINE',
          teamId: query.teamId ?? 'team_sales',
          outboundCount: 5,
          inboundCount: 12,
          fee: 0.0
        }
      ]
    };
  });

}
