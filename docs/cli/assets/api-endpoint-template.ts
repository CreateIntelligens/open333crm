// Backend API Endpoint Template for CLI
// Add to apps/api/src/modules/cli/cli-endpoints.ts

// 1. ADD NEW SCOPE to apps/api/src/modules/auth/cli-session.service.ts:
// export const CLI_YOUR_FEATURE_READ_SCOPE = 'cli:your-feature:read';
// export const DEFAULT_CLI_SCOPES = [CLI_STATUS_SCOPE, CLI_APIS_SCOPE] as const;

// 2. ADD CAPABILITY to cliCapabilities array in cli-endpoints.ts:
{
  name: 'your-feature',
  description: 'Description of what this capability provides',
  scopes: ['cli:your-feature:read'],  // Match scope from cli-session.service.ts
  endpoints: [
    {
      name: 'List Items',
      description: 'Get paginated list of items for CLI workflows',
      method: 'GET',
      path: '/api/v1/cli/your-endpoint',
      params: {
        page: { desc: 'Page number (1-based)', value: 1 },
        limit: { desc: 'Items per page', value: 20 },
        filter: { desc: 'Filter by name or status', value: 'active' },
        sort: { desc: 'Sort field', value: 'createdAt' },
        order: { desc: 'Sort order: asc or desc', value: 'desc' },
      },
    },
    {
      name: 'Get Item',
      description: 'Get single item by ID',
      method: 'GET',
      path: '/api/v1/cli/your-endpoint/:id',
      params: {
        id: { desc: 'Item UUID', value: '550e8400-e29b-41d4-a716-446655440000' },
      },
    },
  ],
}

// 3. ADD ROUTE to apps/api/src/modules/cli/cli.routes.ts:
import { CLI_YOUR_FEATURE_READ_SCOPE } from '../auth/cli-session-service.js';

fastify.get('/your-endpoint', {
  preHandler: [fastify.authenticateCliSession],
}, async (request, reply) => {
  if (!hasCurrentCliScope(request, CLI_YOUR_FEATURE_READ_SCOPE)) {
    return sendInsufficientScope(reply, CLI_YOUR_FEATURE_READ_SCOPE);
  }

  // Validate query params with Zod
  const querySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    filter: z.string().optional(),
    sort: z.string().default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  });
  const { page, limit, filter, sort, order } = querySchema.parse(request.query);

  // Query database with tenant isolation
  const tenantId = request.agent.tenantId;
  const [items, total] = await Promise.all([
    fastify.prisma.yourModel.findMany({
      where: {
        tenantId,
        // Add filter logic
        ...(filter ? { name: { contains: filter, mode: 'insensitive' } } : {}),
      },
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
    }),
    fastify.prisma.yourModel.count({
      where: { tenantId, ...(filter ? { name: { contains: filter, mode: 'insensitive' } } : {}) },
    }),
  ]);

  return reply.send(success({ items, total, page, limit, totalPages: Math.ceil(total / limit) }));
});

fastify.get('/your-endpoint/:id', {
  preHandler: [fastify.authenticateCliSession],
}, async (request, reply) => {
  if (!hasCurrentCliScope(request, CLI_YOUR_FEATURE_READ_SCOPE)) {
    return sendInsufficientScope(reply, CLI_YOUR_FEATURE_READ_SCOPE);
  }

  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

  const item = await fastify.prisma.yourModel.findFirst({
    where: { id, tenantId: request.agent.tenantId },
  });

  if (!item) {
    return reply.status(404).send(success(null, 'NOT_FOUND'));
  }

  return reply.send(success(item));
});

// 4. ADD TYPE to apps/cli/src/types.ts:
export interface YourResponseType {
  items: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// For single item:
export interface YourItemResponse {
  id: string;
  name: string;
  description: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}