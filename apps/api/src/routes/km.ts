import { FastifyInstance } from 'fastify';
import { requireFeature } from '../guards/license.guard.js';

/**
 * KM (Knowledge Management) Routes
 * Handles file ingestion and article management.
 */
export default async function kmRoutes(app: FastifyInstance) {
  // Ingest a file (PDF, Docx, Audio)
  app.post('/ingest', {
    preHandler: [requireFeature('km.ingestion')],
    handler: async (request, reply) => {
      // TODO: Implement file upload handling (e.g., using @fastify/multipart)
      // TODO: Call MarkitdownService or WhisperService
      return { status: 'success', message: 'File ingestion started (placeholder)' };
    }
  });

  // List KM articles
  app.get('/articles', async (request, reply) => {
    // TODO: Query Prisma for KmArticle
    return [];
  });
}
