import { FastifyRequest, FastifyReply } from 'fastify';
import { licenseService } from '../services/license.js';

export const requireFeature = (featurePath: string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!licenseService.isFeatureEnabled(featurePath)) {
      return reply.status(402).send({
        success: false,
        error: {
          code: 'FEATURE_NOT_ENABLED',
          message: '此功能未在您的授權方案內，請聯繫客服升級',
          featurePath,
        }
      });
    }
  };
};

export const requireCredits = (creditType: string, amount: number = 1) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!licenseService.hasCredits(creditType, amount)) {
      return reply.status(402).send({
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: `${creditType} 點數不足，請充值後再試`,
          creditType,
        }
      });
    }
  };
};
