import assert from 'node:assert/strict';
import { shouldRunAgentReply } from '../modules/automation/automation.worker.js';

assert.equal(shouldRunAgentReply('off'), false);
assert.equal(shouldRunAgentReply('keyword'), false);
assert.equal(shouldRunAgentReply('llm'), true);
assert.equal(shouldRunAgentReply('keyword_then_llm'), true);

console.log('agent automation guard tests passed');
process.exit(0);
