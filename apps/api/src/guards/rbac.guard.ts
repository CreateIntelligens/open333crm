import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * RBAC guard factory.
 *
 * Returns a Fastify preHandler that enforces role-based access control.
 * Must be placed AFTER `fastify.authenticate` in the preHandler array.
 *
 * @example
 * fastify.delete('/:id', {
 *   preHandler: [fastify.authenticate, requireAdmin()],
 * }, handler);
 */
export const requireRole = (allowedRoles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.agent?.role;
    if (!role || !allowedRoles.includes(role)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Insufficient role',
      });
    }
  };
};

/** Only ADMIN may proceed. */
export const requireAdmin = () => requireRole(['ADMIN']);

/** ADMIN or SUPERVISOR may proceed. */
export const requireSupervisor = () => requireRole(['ADMIN', 'SUPERVISOR']);
