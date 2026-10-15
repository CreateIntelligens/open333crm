/**
 * 客服把對話交回 Bot（change add-return-conversation-to-bot，spec core-inbox「客服把對話交回 Bot」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { returnConversationToBot } from '#src/modules/conversation/conversation.service.js';
import { AppError } from '#src/shared/utils/response.js';

function fixture(conv: { status: string; botMode?: string }, opts: { closedMeanwhile?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const updateWheres: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const emitted: string[] = [];
  const prisma = {
    conversation: {
      findFirst: async () => ({
        id: 'c1',
        tenantId: 't1',
        status: conv.status,
        botRepliesCount: 3,
        handoffReason: 'manual_takeover',
        assignedToId: 'agent-a',
        channel: { settings: conv.botMode ? { botConfig: { botMode: conv.botMode } } : {} },
      }),
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updateWheres.push(args.where);
        if (opts.closedMeanwhile) return { count: 0 };
        updates.push(args.data);
        return { count: 1 };
      },
      findFirstOrThrow: async () => ({ id: 'c1', status: 'BOT_HANDLED', assignedToId: 'agent-a', unreadCount: 0, updatedAt: new Date() }),
    },
    agent: { findFirst: async () => ({ name: '小美' }) },
    message: {
      create: async (args: { data: Record<string, unknown> }) => {
        messages.push(args.data);
        return { id: 'm1', ...args.data, createdAt: new Date() };
      },
    },
  } as never;
  const io = { to: () => ({ emit: (event: string) => emitted.push(event) }) } as never;
  return { prisma, io, updates, updateWheres, messages, emitted };
}

async function rejects400(p: Promise<unknown>, pattern?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof AppError, String(err));
    assert.equal(err.statusCode, 400);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

test('客服接手的對話交回 Bot', async () => {
  const f = fixture({ status: 'AGENT_HANDLED' });
  await returnConversationToBot(f.prisma, f.io, 'c1', 't1', 'agent-b');
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0], { status: 'BOT_HANDLED', botRepliesCount: 0, handoffReason: null });
  assert.ok(!('assignedTo' in f.updates[0]) && !('assignedToId' in f.updates[0]), '保留指派的客服');
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].senderType, 'SYSTEM');
  assert.match(JSON.stringify(f.messages[0].content), /小美.*交回 Bot/);
  assert.ok(f.emitted.includes('conversation.updated') && f.emitted.includes('message.new'));
  assert.equal(f.updateWheres[0].tenantId, 't1', '更新條件帶租戶');
});

test('檢查後對話被結案時不改狀態', async () => {
  // 讀到 AGENT_HANDLED 之後、更新之前，另一位客服把對話結案：不可以把已結案的對話改回 Bot
  const f = fixture({ status: 'AGENT_HANDLED' }, { closedMeanwhile: true });
  await rejects400(returnConversationToBot(f.prisma, f.io, 'c1', 't1', 'agent-b'));
  assert.equal(f.updates.length, 0);
  assert.equal(f.messages.length, 0, '沒有交回就不寫系統訊息');
});

test('已結案的對話', async () => {
  const f = fixture({ status: 'CLOSED' });
  await rejects400(returnConversationToBot(f.prisma, f.io, 'c1', 't1', 'agent-b'), /重新開啟/);
  assert.equal(f.updates.length, 0);
});

test('已經是 Bot 處理', async () => {
  const f = fixture({ status: 'BOT_HANDLED' });
  await rejects400(returnConversationToBot(f.prisma, f.io, 'c1', 't1', 'agent-b'));
  assert.equal(f.updates.length, 0);
});

test('渠道的 bot 已關閉', async () => {
  const f = fixture({ status: 'ACTIVE', botMode: 'off' });
  await rejects400(returnConversationToBot(f.prisma, f.io, 'c1', 't1', 'agent-b'), /機器人已關閉/);
  assert.equal(f.updates.length, 0);
});
