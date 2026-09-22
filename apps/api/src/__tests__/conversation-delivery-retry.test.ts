import assert from 'node:assert/strict';
import { mergeLineDeliveryMetadata } from '../modules/conversation/conversation.service.js';

const accepted = mergeLineDeliveryMetadata(
  { source: 'mcp' },
  '00000000-0000-0000-0000-000000000001',
  { success: true, requestId: 'line-request-1' },
);

assert.deepEqual(accepted, {
  source: 'mcp',
  lineRetryKey: '00000000-0000-0000-0000-000000000001',
  lineDeliveryStatus: 'accepted',
  lineRequestId: 'line-request-1',
});

const failed = mergeLineDeliveryMetadata(null, '00000000-0000-0000-0000-000000000002', { success: false });
assert.deepEqual(failed, {
  lineRetryKey: '00000000-0000-0000-0000-000000000002',
  lineDeliveryStatus: 'failed',
});

console.log('conversation-delivery-retry.test.ts passed');
process.exit(0);
