import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';

const PASSKEY_CHALLENGE_PREFIX = 'webauthn:challenge';

export type PasskeyChallengePurpose = 'registration' | 'authentication';

export interface PasskeyChallenge {
  challengeId: string;
  challenge: string;
  purpose: PasskeyChallengePurpose;
  tenantId?: string;
  agentId?: string;
  rememberMe?: boolean;
}

export interface PasskeyChallengeRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  getdel(key: string): Promise<string | null>;
}

export interface PasskeyConfig {
  rpID: string;
  rpName: string;
  origin: string;
  challengeTtlSeconds: number;
}

let redisClient: IORedis | null = null;

function getPasskeyRedis(): PasskeyChallengeRedis {
  redisClient ??= new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
  return redisClient;
}

export function getPasskeyChallengeKey(challengeId: string): string {
  return `${PASSKEY_CHALLENGE_PREFIX}:${challengeId}`;
}

export function createPasskeyChallengeId(): string {
  return randomUUID();
}

export function getPasskeyConfig(): PasskeyConfig {
  const config = getConfig();
  const rpID = config.WEBAUTHN_RP_ID?.trim();
  const configuredOrigin = config.WEBAUTHN_ORIGIN?.trim();

  if (!rpID || !configuredOrigin) {
    throw new AppError(
      'Passkey authentication is not configured',
      'SERVICE_UNAVAILABLE',
      503,
    );
  }

  if (rpID.includes('://') || rpID.includes('/') || rpID.includes(':') || /\s/.test(rpID)) {
    throw new AppError('Invalid WebAuthn RP ID configuration', 'INTERNAL_ERROR', 500);
  }

  let origin: string;
  try {
    const parsedOrigin = new URL(configuredOrigin);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
      throw new Error('Origin must contain only scheme and host');
    }
    if (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
      throw new Error('Production WebAuthn origin must use HTTPS');
    }
    origin = parsedOrigin.origin;
  } catch {
    throw new AppError('Invalid WebAuthn origin configuration', 'INTERNAL_ERROR', 500);
  }

  return {
    rpID,
    rpName: config.WEBAUTHN_RP_NAME,
    origin,
    challengeTtlSeconds: config.WEBAUTHN_CHALLENGE_TTL_SECONDS,
  };
}

export async function savePasskeyChallenge(
  redis: PasskeyChallengeRedis,
  challenge: PasskeyChallenge,
  ttlSeconds: number,
): Promise<void> {
  const result = await redis.set(
    getPasskeyChallengeKey(challenge.challengeId),
    JSON.stringify(challenge),
    'PX',
    ttlSeconds * 1000,
    'NX',
  );

  if (result !== 'OK') {
    throw new AppError('Passkey challenge already exists', 'CONFLICT', 409);
  }
}

export async function consumePasskeyChallenge(
  redis: PasskeyChallengeRedis,
  challengeId: string,
): Promise<PasskeyChallenge | null> {
  const raw = await redis.getdel(getPasskeyChallengeKey(challengeId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PasskeyChallenge>;
    if (
      typeof parsed.challengeId !== 'string'
      || typeof parsed.challenge !== 'string'
      || (parsed.purpose !== 'registration' && parsed.purpose !== 'authentication')
      || (parsed.tenantId !== undefined && typeof parsed.tenantId !== 'string')
      || (parsed.agentId !== undefined && typeof parsed.agentId !== 'string')
      || (parsed.rememberMe !== undefined && typeof parsed.rememberMe !== 'boolean')
      || parsed.challengeId !== challengeId
    ) {
      throw new Error('Invalid challenge shape');
    }
    return parsed as PasskeyChallenge;
  } catch {
    throw new AppError('Invalid passkey challenge', 'UNAUTHORIZED', 401);
  }
}

export async function storePasskeyChallenge(challenge: PasskeyChallenge): Promise<void> {
  const config = getPasskeyConfig();
  await savePasskeyChallenge(getPasskeyRedis(), challenge, config.challengeTtlSeconds);
}

export async function takePasskeyChallenge(challengeId: string): Promise<PasskeyChallenge> {
  const challenge = await consumePasskeyChallenge(getPasskeyRedis(), challengeId);
  if (!challenge) {
    throw new AppError('Passkey challenge is missing or expired', 'UNAUTHORIZED', 401);
  }
  return challenge;
}
