import { FastifyInstance } from 'fastify';
import { requireFeature, requireCredits } from '../guards/license.guard.js';

/**
 * Brain Routes
 * Handles AI-assisted suggestions and retrieval.
 */
export default async function brainRoutes(app: FastifyInstance) {
  // Suggest a reply with KM and LTM context
  app.post('/suggest', {
    preHandler: [
      requireFeature('ai.suggestions'),
      requireCredits('ai_token', 1)
    ],
    handler: async (request: any, reply) => {
      const { text, contactId } = request.body;
      const teamId = request.user?.teamId;
      
      // TODO: Initialize services and call BrainService.getContext(text, queryVector, contactId, teamId)
      
      return { 
        suggestion: 'This is a mock AI suggestion based on KM and LTM with teamId filtering.',
        source: 'km',
        triggeredLTM: false,
        teamId
      };
    }
  });
}
