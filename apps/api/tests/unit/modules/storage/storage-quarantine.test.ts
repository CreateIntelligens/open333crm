import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildQuarantineKey,
  isTenantQuarantineKey,
} from '#src/modules/storage/storage.service.js';

test('storage-quarantine', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const key = buildQuarantineKey(tenantId, 'manual.pdf', 'knowledge');

  assert.match(key, new RegExp(`^${tenantId}/quarantine/knowledge/[0-9a-f-]+\\.pdf$`));
  assert.equal(isTenantQuarantineKey(key, tenantId), true);
  assert.equal(isTenantQuarantineKey(key, '22222222-2222-4222-8222-222222222222'), false);
  assert.equal(isTenantQuarantineKey(`${tenantId}/media/file.pdf`, tenantId), false);
  assert.equal(isTenantQuarantineKey(`${tenantId}/quarantine/../media/file.pdf`, tenantId), false);
});
