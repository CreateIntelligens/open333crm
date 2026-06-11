import { FastifyRequest, FastifyReply } from 'fastify';
import { LicenseDecision, licenseService } from '../services/license.js';

const sendLicenseError = (reply: FastifyReply, decision: LicenseDecision) => {
  return reply.status(decision.statusCode ?? 402).send({
    success: false,
    error: {
      code: decision.code,
      message: decision.message,
      featurePath: decision.featurePath,
      creditType: decision.creditType,
      channelType: decision.channelType,
      limit: decision.limit,
      current: decision.current,
    },
  });
};

const sendProviderUnavailable = (reply: FastifyReply) => {
  return reply.status(503).send({
    success: false,
    error: {
      code: 'LICENSE_PROVIDER_UNAVAILABLE',
      message: 'License provider unavailable',
    },
  });
};

export const requireFeature = (featurePath: string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decision = await licenseService.checkFeature(featurePath, {
        tenantId: request.agent?.tenantId,
        agentId: request.agent?.id,
      });
      if (!decision.allowed) {
        return sendLicenseError(reply, decision);
      }
    } catch (error) {
      return sendProviderUnavailable(reply);
    }
  };
};

export const requireCredits = (creditType: string, amount: number = 1) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decision = await licenseService.checkCredits(creditType, amount, {
        tenantId: request.agent?.tenantId,
        agentId: request.agent?.id,
      });
      if (!decision.allowed) {
        return sendLicenseError(reply, decision);
      }
    } catch (error) {
      return sendProviderUnavailable(reply);
    }
  };
};
