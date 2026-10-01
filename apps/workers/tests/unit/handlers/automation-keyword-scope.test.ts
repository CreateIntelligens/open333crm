import assert from 'node:assert/strict';
import { handleAutomationJob } from '../handlers/automation.handler';

async function testKeywordMatchedJobScopesCandidateRuleByMatchedRuleId() {
  const findManyCalls: unknown[] = [];
  const rules = [
    {
      id: 'rule-test',
      name: 'test keyword',
      priority: 10,
      stopOnMatch: false,
      conditions: { all: [] },
      actions: [],
    },
    {
      id: 'rule-line-text',
      name: 'line_text keyword',
      priority: 10,
      stopOnMatch: false,
      conditions: { all: [] },
      actions: [],
    },
  ];

  const prisma = {
    automationRule: {
      async findMany(args: { where: { id?: string } }) {
        findManyCalls.push(args);
        return args.where.id
          ? rules.filter((rule) => rule.id === args.where.id)
          : rules;
      },
    },
  };

  const publishCalls: unknown[] = [];
  const redisPublisher = {
    async publish(channel: string, payload: string) {
      publishCalls.push({ channel, payload });
      return 1;
    },
  };

  await handleAutomationJob(
    {
      data: {
        tenantId: 'tenant-1',
        trigger: 'keyword.matched',
        context: {
          ruleId: 'rule-test',
          messageContent: 'test',
          matchedKeywords: ['test'],
        },
      },
    } as any,
    prisma as any,
    redisPublisher as any,
  );

  assert.equal(findManyCalls.length, 1);
  assert.deepEqual(findManyCalls[0], {
    where: {
      tenantId: 'tenant-1',
      eventType: 'keyword.matched',
      isActive: true,
      id: 'rule-test',
    },
  });
  assert.equal(publishCalls.length, 1);
  assert.match(JSON.stringify(publishCalls[0]), /rule-test/);
  assert.doesNotMatch(JSON.stringify(publishCalls[0]), /rule-line-text/);
}

async function main() {
  await testKeywordMatchedJobScopesCandidateRuleByMatchedRuleId();
  console.log('automation-keyword-scope tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
