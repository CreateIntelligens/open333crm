import assert from 'node:assert/strict';
import {
  getChatboxSessionTtlMs,
  issueChatboxSessionId,
} from '../modules/chatbox/chatbox.service.js';
import {
  createChatboxMessageRegistry,
  registerBuiltInChatboxMessageHandlers,
} from '../modules/chatbox/chatbox.registry.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-chatbox-security-secret';
process.env.CHATBOX_SESSION_SECRET = process.env.CHATBOX_SESSION_SECRET || 'test-chatbox-session-secret';

const originalTtl = process.env.CHATBOX_SESSION_TTL_MINUTES;
process.env.CHATBOX_SESSION_TTL_MINUTES = String(4 * 24 * 60);
assert.equal(getChatboxSessionTtlMs(), 3 * 24 * 60 * 60 * 1000);
if (originalTtl === undefined) delete process.env.CHATBOX_SESSION_TTL_MINUTES;
else process.env.CHATBOX_SESSION_TTL_MINUTES = originalTtl;

const registry = createChatboxMessageRegistry();
registerBuiltInChatboxMessageHandlers(registry);
assert.throws(() => registry.parse({
  sessionId: 's'.repeat(32),
  claimToken: 'c'.repeat(32),
  clientMessageId: 'message-1',
  type: 'text',
  payload: { text: 'x'.repeat(4_001) },
}), /at most 4000/);

const issued = issueChatboxSessionId();
assert.ok(issued.sessionId.startsWith('cb2.'));

console.log('chatbox security tests passed');
process.exit(0);
