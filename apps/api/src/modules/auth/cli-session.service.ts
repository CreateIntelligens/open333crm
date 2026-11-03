import { randomBytes } from 'node:crypto';
import type { CliSession, Prisma, PrismaClient } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
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

/** 新 token 的明文與要存的欄位。由 generateCliToken() 在交易外產生 */
export interface GeneratedCliToken {
  /** 明文只在建立時回傳一次，不寫入資料庫 */
  token: string;
  tokenHash: string;
  tokenPrefix: string;
  tokenSuffix: string;
}

export interface CreateCliSessionInput {
  agentId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date;
  token: GeneratedCliToken;
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

/**
 * 產生 token 並以 bcrypt 雜湊。bcrypt 很吃 CPU，呼叫端在交易外執行（AGENTS.md 結構規則 2）。
 */
export async function generateCliToken(): Promise<GeneratedCliToken> {
  const random = randomBytes(TOKEN_RANDOM_BYTES).toString('hex');
  const token = `${TOKEN_PREFIX}${random}`;
  return { token, tokenHash: await hashPassword(token), ...visibleParts(random) };
}

/** 寫入 generateCliToken() 產生的 token。CLI 登入與設定頁共用 */
export async function createCliSession(ctx: TenantCtx, input: CreateCliSessionInput): Promise<CliSession> {
  const scopes = input.scopes ?? [...DEFAULT_CLI_SCOPES];
  return ctx.tx.cliSession.create({
    data: {
      tenantId: ctx.tenantId,
      agentId: input.agentId,
      name: input.name,
      tokenHash: input.token.tokenHash,
      tokenPrefix: input.token.tokenPrefix,
      tokenSuffix: input.token.tokenSuffix,
      scopes: scopes as unknown as Prisma.InputJsonValue,
      expiresAt: input.expiresAt ?? defaultExpiry(),
    },
  });
}

/** 租戶內所有成員還沒有撤銷的 token，由新到舊 */
export async function listCliSessions(ctx: TenantCtx) {
  return ctx.tx.cliSession.findMany({
    where: { tenantId: ctx.tenantId, revokedAt: null },
    include: { agent: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function verifyCliSession(
  // 驗證時還不知道租戶：auth.plugin 以 prismaAdmin（BYPASSRLS）依前綴查詢
  prisma: PrismaClient,
  rawToken: string,
): Promise<VerifyCliSessionResult> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: 'CLI 權杖格式不正確，請重新執行 open333 login' };
  }

  const random = rawToken.slice(TOKEN_PREFIX.length);
  if (random.length < TOKEN_PREFIX_VISIBLE_HEX + TOKEN_SUFFIX_VISIBLE_HEX) {
    return { ok: false, reason: 'CLI 權杖格式不正確，請重新執行 open333 login' };
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
      return { ok: false, reason: 'CLI 權杖已被撤銷，請重新執行 open333 login' };
    }
    if (candidate.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'CLI 權杖已過期，請重新執行 open333 login' };
    }
    if (!candidate.agent.isActive) {
      return { ok: false, reason: '此帳號已被停用，請聯繫管理員' };
    }

    touchCliSessionLastUsedAt(prisma, candidate.id);
    return {
      ok: true,
      session: candidate,
      scopes: parseCliScopes(candidate.scopes),
      agent: candidate.agent,
    };
  }

  return { ok: false, reason: 'CLI 權杖無效，請重新執行 open333 login' };
}

export function touchCliSessionLastUsedAt(prisma: PrismaClient, id: string): void {
  prisma.cliSession
    .update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch((err) =>
      logger.warn(`[CliSession] Failed to touch lastUsedAt for ${id}: ${(err as Error).message}`),
    );
}

/** 回傳撤銷的筆數：0 代表 token 不存在、屬於另一個租戶，或已經撤銷 */
export async function revokeCliSession(ctx: TenantCtx, id: string): Promise<number> {
  // 已經撤銷的不再更新：保留原本的撤銷時間，也不重複寫稽核
  const { count } = await ctx.tx.cliSession.updateMany({
    where: { id, tenantId: ctx.tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}
