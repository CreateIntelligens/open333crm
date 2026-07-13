import { randomBytes } from 'node:crypto';
import type { CliSession, Prisma, PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { logger } from '@open333crm/core';

const TOKEN_PREFIX = 'cli_';
const TOKEN_RANDOM_BYTES = 32;
const TOKEN_PREFIX_VISIBLE_HEX = 5;
const TOKEN_SUFFIX_VISIBLE_HEX = 4;
const DEFAULT_EXPIRES_DAYS = 30;

export const CLI_STATUS_SCOPE = 'cli:status';
export const CLI_APIS_SCOPE = 'cli:apis';
export const CLI_ANALYTICS_READ_SCOPE = 'cli:analytics:read';
export const DEFAULT_CLI_SCOPES = [CLI_STATUS_SCOPE, CLI_APIS_SCOPE, CLI_ANALYTICS_READ_SCOPE] as const;

export interface CreateCliSessionInput {
  tenantId: string;
  agentId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date;
}

export interface CreateCliSessionResult {
  token: string;
  session: CliSession;
}

export type VerifyCliSessionResult =
  | {
      ok: true;
      session: CliSession;
      scopes: string[];
      agent: {
        id: string;
        tenantId: string;
        email: string;
        name: string;
        role: string;
        avatarUrl: string | null;
        isActive: boolean;
      };
    }
  | { ok: false; reason: string };

function defaultExpiry(): Date {
  return new Date(Date.now() + DEFAULT_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

function visibleParts(randomHex: string): { tokenPrefix: string; tokenSuffix: string } {
  return {
    tokenPrefix: `${TOKEN_PREFIX}${randomHex.slice(0, TOKEN_PREFIX_VISIBLE_HEX)}`,
    tokenSuffix: randomHex.slice(-TOKEN_SUFFIX_VISIBLE_HEX),
  };
}

export function parseCliScopes(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is string => typeof scope === 'string');
}

export function hasCliScope(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope);
}

export async function createCliSession(
  prisma: PrismaClient,
  input: CreateCliSessionInput,
): Promise<CreateCliSessionResult> {
  const random = randomBytes(TOKEN_RANDOM_BYTES).toString('hex');
  const token = `${TOKEN_PREFIX}${random}`;
  const tokenHash = await hashPassword(token);
  const { tokenPrefix, tokenSuffix } = visibleParts(random);
  const scopes = input.scopes ?? [...DEFAULT_CLI_SCOPES];

  const session = await prisma.cliSession.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      name: input.name,
      tokenHash,
      tokenPrefix,
      tokenSuffix,
      scopes: scopes as unknown as Prisma.InputJsonValue,
      expiresAt: input.expiresAt ?? defaultExpiry(),
    },
  });

  return { token, session };
}

export async function verifyCliSession(
  prisma: PrismaClient,
  rawToken: string,
): Promise<VerifyCliSessionResult> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: 'Malformed CLI token' };
  }

  const random = rawToken.slice(TOKEN_PREFIX.length);
  if (random.length < TOKEN_PREFIX_VISIBLE_HEX + TOKEN_SUFFIX_VISIBLE_HEX) {
    return { ok: false, reason: 'Malformed CLI token' };
  }

  const { tokenPrefix } = visibleParts(random);
  const candidates = await prisma.cliSession.findMany({
    where: { tokenPrefix },
    include: {
      agent: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          isActive: true,
        },
      },
    },
  });

  for (const candidate of candidates) {
    const matches = await verifyPassword(rawToken, candidate.tokenHash);
    if (!matches) continue;

    if (candidate.revokedAt) {
      return { ok: false, reason: 'CLI token revoked' };
    }
    if (candidate.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'CLI token expired' };
    }
    if (!candidate.agent.isActive) {
      return { ok: false, reason: 'Agent account disabled' };
    }

    touchCliSessionLastUsedAt(prisma, candidate.id);
    return {
      ok: true,
      session: candidate,
      scopes: parseCliScopes(candidate.scopes),
      agent: candidate.agent,
    };
  }

  return { ok: false, reason: 'Invalid CLI token' };
}

export function touchCliSessionLastUsedAt(prisma: PrismaClient, id: string): void {
  prisma.cliSession
    .update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch((err) =>
      logger.warn(`[CliSession] Failed to touch lastUsedAt for ${id}: ${(err as Error).message}`),
    );
}

export async function revokeCliSession(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
): Promise<void> {
  await prisma.cliSession.updateMany({
    where: { id, tenantId },
    data: { revokedAt: new Date() },
  });
}
