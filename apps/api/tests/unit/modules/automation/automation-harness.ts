/**
 * 自動化訂閱者單元測試用的假資料庫（change outbox-event-delivery 第 8 節）。
 *
 * - tenantPrisma.$transaction 模擬 inTenant() 的交易：callback 丟錯時把狀態還原成交易開始前，等同 rollback。
 * - adminPrisma 是交易外的連線（LLM 階段與 BOT_HANDLED 的判斷）。
 * - 認領紀錄、outbox、訊息都放在記憶體；兩條連線看到同一份狀態。
 */
import { randomUUID } from 'node:crypto';

export const TENANT = 'a0000000-0000-0000-0000-000000000001';
export const CONVERSATION = 'c0000000-0000-0000-0000-00000000000c';
export const MESSAGE = 'b0000000-0000-0000-0000-00000000000b';

export interface HarnessState {
  conversation: {
    id: string;
    tenantId: string;
    status: string;
    handoffReason: string | null;
    botRepliesCount: number;
    lastMessageAt: Date | null;
    metadata: Record<string, unknown>;
  };
  botConfig: Record<string, unknown>;
  claims: string[];
  outbox: Array<{ id: string; name: string; payload: Record<string, unknown> }>;
  messages: Array<{ id: string; senderType: string; contentType: string; content: unknown; metadata: Record<string, unknown> }>;
  /** 寫入系統訊息時丟錯（「寫入系統訊息失敗」） */
  failSystemMessage: boolean;
  /** 以這個種類認領時丟錯，模擬認領的交易失敗（「Claim transaction fails」） */
  failClaimKind: string | null;
}

export function createHarness(overrides: { botRepliesCount?: number; botConfig?: Record<string, unknown> } = {}) {
  const state: HarnessState = {
    conversation: {
      id: CONVERSATION,
      tenantId: TENANT,
      status: 'BOT_HANDLED',
      handoffReason: null,
      botRepliesCount: overrides.botRepliesCount ?? 0,
      lastMessageAt: null,
      metadata: {},
    },
    botConfig: { botMode: 'llm', handoffKeywords: [], maxBotReplies: 5, ...overrides.botConfig },
    claims: [],
    outbox: [],
    messages: [{ id: MESSAGE, senderType: 'CONTACT', contentType: 'text', content: { text: 'hi' }, metadata: {} }],
    failSystemMessage: false,
    failClaimKind: null,
  };

  const claimKey = (r: { kind: string; sourceId: string; subKey?: string }) => `${r.kind}|${r.sourceId}|${r.subKey ?? ''}`;

  function conversationRow() {
    return {
      ...state.conversation,
      assignedToId: null,
      unreadCount: 0,
      updatedAt: new Date(),
      channel: { settings: { botConfig: state.botConfig } },
    };
  }

  function matchesConversation(where: { id?: string; tenantId?: string; status?: string }) {
    return (
      (!where.id || where.id === state.conversation.id) &&
      (!where.tenantId || where.tenantId === state.conversation.tenantId) &&
      (!where.status || where.status === state.conversation.status)
    );
  }

  const models = {
    conversation: {
      findFirst: async ({ where }: { where: { id?: string; tenantId?: string; status?: string } }) =>
        matchesConversation(where) ? conversationRow() : null,
      findUnique: async () => conversationRow(),
      updateMany: async ({ where, data }: { where: { id?: string; tenantId?: string; status?: string }; data: Record<string, unknown> }) => {
        if (!matchesConversation(where)) return { count: 0 };
        for (const [k, v] of Object.entries(data)) {
          const current = (state.conversation as Record<string, unknown>)[k];
          (state.conversation as Record<string, unknown>)[k] =
            v && typeof v === 'object' && 'increment' in v ? (current as number) + (v as { increment: number }).increment : v;
        }
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        for (const [k, v] of Object.entries(data)) {
          const current = (state.conversation as Record<string, unknown>)[k];
          (state.conversation as Record<string, unknown>)[k] =
            v && typeof v === 'object' && 'increment' in v ? (current as number) + (v as { increment: number }).increment : v;
        }
        return conversationRow();
      },
    },
    message: {
      create: async ({ data }: { data: { senderType: string; contentType: string; content: unknown; metadata?: Record<string, unknown> } }) => {
        if (data.senderType === 'SYSTEM' && state.failSystemMessage) throw new Error('system message write failed');
        const row = { id: randomUUID(), senderType: data.senderType, contentType: data.contentType, content: data.content, metadata: data.metadata ?? {} };
        state.messages.push(row);
        return { ...row, createdAt: new Date() };
      },
      findUnique: async ({ where }: { where: { id: string } }) => state.messages.find((m) => m.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { id: string } }) => state.messages.find((m) => m.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { metadata: Record<string, unknown> } }) => {
        const m = state.messages.find((x) => x.id === where.id)!;
        m.metadata = data.metadata;
        return m;
      },
      updateMany: async ({ where, data }: { where: { id: string }; data: { metadata: Record<string, unknown> } }) => {
        const m = state.messages.find((x) => x.id === where.id);
        if (!m) return { count: 0 };
        m.metadata = data.metadata;
        return { count: 1 };
      },
    },
    sideEffectClaim: {
      createMany: async ({ data }: { data: Array<{ kind: string; sourceId: string; subKey?: string }> }) => {
        let count = 0;
        if (data.some((row) => row.kind === state.failClaimKind)) throw new Error('connection reset');
        for (const row of data) {
          if (state.claims.includes(claimKey(row))) continue;
          state.claims.push(claimKey(row));
          count++;
        }
        return { count };
      },
      count: async ({ where }: { where: { kind: string; sourceId: string; subKey?: string } }) =>
        state.claims.includes(claimKey(where)) ? 1 : 0,
    },
    outbox: {
      create: async ({ data }: { data: { name: string; payload: Record<string, unknown>; tenantId: string; kind: string } }) => {
        const row = { id: randomUUID(), name: data.name, payload: data.payload };
        state.outbox.push(row);
        return { ...row, tenantId: data.tenantId, kind: data.kind, queueName: null, jobOptions: null, createdAt: new Date() };
      },
      updateMany: async () => ({ count: 1 }),
    },
    automationRule: { findMany: async () => [] },
    material: { findMany: async () => [] },
    contact: { findFirst: async () => null },
    case: { findFirst: async () => null, count: async () => 0 },
  };

  const tenantPrisma = {
    async $transaction(cb: (tx: unknown) => Promise<unknown>) {
      const snapshot = structuredClone({ ...state, failSystemMessage: undefined, failClaimKind: undefined });
      try {
        return await cb({ $executeRaw: async () => 1, ...models });
      } catch (err) {
        Object.assign(state, { ...snapshot, failSystemMessage: state.failSystemMessage, failClaimKind: state.failClaimKind });
        throw err;
      }
    },
  };
  const adminPrisma = models;
  const io = { to: () => ({ emit: () => {} }) };

  return { state, tenantPrisma, adminPrisma, io, claimKey };
}

export function messageReceived(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'message.received' as const,
    tenantId: TENANT,
    timestamp: new Date(),
    payload: {
      conversationId: CONVERSATION,
      messageId: MESSAGE,
      contactId: 'contact-1',
      channelType: 'LINE',
      contentType: 'text',
      messageContent: '請問一下',
      ...overrides,
    },
  };
}
