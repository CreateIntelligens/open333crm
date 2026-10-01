import assert from 'node:assert/strict';
import { test } from 'vitest';
import { shouldRunAgentReply } from '#src/modules/automation/automation.worker.js';

test('agent-automation-guards', async () => {
  assert.equal(shouldRunAgentReply('off'), false);
  assert.equal(shouldRunAgentReply('keyword'), false);
  assert.equal(shouldRunAgentReply('llm'), true);
  assert.equal(shouldRunAgentReply('keyword_then_llm'), true);
});
