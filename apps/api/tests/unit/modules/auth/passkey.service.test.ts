import assert from 'node:assert/strict';
import {
  consumePasskeyChallenge,
  getPasskeyChallengeKey,
  savePasskeyChallenge,
  type PasskeyChallenge,
  type PasskeyChallengeRedis,
} from '#src/modules/auth/passkey.service.js';
import {
  passkeyAuthenticationOptionsSchema,
  passkeyAuthenticationVerifySchema,
  passkeyRenameSchema,
  passkeyRegistrationVerifySchema,
} from '#src/modules/auth/auth.schema.js';

import { test } from 'vitest';
class FakePasskeyRedis implements PasskeyChallengeRedis {
  readonly values = new Map<string, string>();

  async set(
    key: string,
    value: string,
    _mode: 'PX',
    _ttlMs: number,
    _condition: 'NX',
  ): Promise<'OK' | null> {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}

const challenge: PasskeyChallenge = {
  challengeId: 'challenge-1',
  challenge: 'base64url-challenge',
  purpose: 'authentication',
  tenantId: '22222222-2222-4222-8222-222222222222',
  agentId: '11111111-1111-4111-8111-111111111111',
};

async function testChallengeIsStoredWithTtlAndConsumedOnce() {
  const redis = new FakePasskeyRedis();

  await savePasskeyChallenge(redis, challenge, 120);

  assert.deepEqual(
    JSON.parse(redis.values.get(getPasskeyChallengeKey(challenge.challengeId)) ?? '{}'),
    challenge,
  );
  assert.deepEqual(await consumePasskeyChallenge(redis, challenge.challengeId), challenge);
  assert.equal(await consumePasskeyChallenge(redis, challenge.challengeId), null);
}

async function testChallengeCannotBeOverwrittenBeforeConsumption() {
  const redis = new FakePasskeyRedis();

  await savePasskeyChallenge(redis, challenge, 120);

  await assert.rejects(
    savePasskeyChallenge(redis, { ...challenge, challenge: 'replacement' }, 120),
    { code: 'CONFLICT', statusCode: 409 },
  );
}

async function testMalformedChallengeIsRejected() {
  const redis = new FakePasskeyRedis();
  redis.values.set(getPasskeyChallengeKey('malformed'), JSON.stringify({ challengeId: 'wrong' }));

  await assert.rejects(
    consumePasskeyChallenge(redis, 'malformed'),
    { code: 'UNAUTHORIZED', statusCode: 401 },
  );
}

function testPasskeyRequestSchemasRejectMalformedCredentialData() {
  assert.deepEqual(
    passkeyAuthenticationOptionsSchema.parse({}).rememberMe,
    false,
  );
  assert.throws(
    () => passkeyAuthenticationVerifySchema.parse({
      challengeId: '11111111-1111-4111-8111-111111111111',
      response: {
        id: 'not base64url!',
        rawId: 'raw-id',
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: 'client-data',
          authenticatorData: 'auth-data',
          signature: 'signature',
        },
      },
    }),
  );
}

function testPasskeyNameIsTrimmedAndDefaultsForLegacyClients() {
  const response = {
    id: 'credential-id',
    rawId: 'raw-id',
    type: 'public-key' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: 'client-data',
      attestationObject: 'attestation-object',
    },
  };
  const challengeId = '11111111-1111-4111-8111-111111111111';

  assert.equal(
    passkeyRegistrationVerifySchema.parse({ challengeId, response, name: '  MacBook Touch ID  ' }).name,
    'MacBook Touch ID',
  );
  assert.equal(
    passkeyRegistrationVerifySchema.parse({ challengeId, response }).name,
    'Passkey',
  );
  assert.equal(passkeyRenameSchema.parse({ name: '  iPhone  ' }).name, 'iPhone');
}

test('challenge is stored with ttl and consumed once', testChallengeIsStoredWithTtlAndConsumedOnce);
test('challenge cannot be overwritten before consumption', testChallengeCannotBeOverwrittenBeforeConsumption);
test('malformed challenge is rejected', testMalformedChallengeIsRejected);
test('passkey request schemas reject malformed credential data', testPasskeyRequestSchemasRejectMalformedCredentialData);
test('passkey name is trimmed and defaults for legacy clients', testPasskeyNameIsTrimmedAndDefaultsForLegacyClients);
