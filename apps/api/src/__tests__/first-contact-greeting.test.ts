/**
 * 首次進站招呼語測試 — CM-176
 *
 * 本檔覆蓋招呼語送出端的行為：
 *   1. 首次進站送出招呼語（含變數替換）
 *   2. 非首次不送（每位聯絡人每渠道只送一次）
 *   3. 未設定／空白招呼語不送（功能預設關閉）
 *   4. 推送失敗不得向外拋錯（失敗隔離，CM-175 教訓）
 *   5. 變數解析不到時仍送出，不擋發送
 *
 * isFirstContact 的判定本身（含併發撞 P2002 只有一方為首次、以及
 * contact.created 事件發布）由 inbound-first-contact-resolver.test.ts 覆蓋。
 */

import assert from 'node:assert/strict';

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-first-contact-greeting-secret';

type AnyRecord = Record<string, any>;

interface Sent {
  messages: AnyRecord[];
  delivered: string[];
  socketEvents: string[];
}

/** 假的租戶綁定 Prisma executor。 */
function createDb(sent: Sent, options: { greeting?: string | null } = {}) {
  const { greeting = null } = options;
  return {
    channel: {
      async findFirst() {
        return { settings: greeting === null ? {} : { firstContactGreeting: greeting } };
      },
    },
    message: {
      async create({ data }: AnyRecord) {
        sent.messages.push(data);
        return { ...data, id: `msg-${sent.messages.length}`, createdAt: new Date() };
      },
    },
    conversation: {
      async update({ data }: AnyRecord) {
        return data;
      },
    },
  } as AnyRecord;
}

function createCtx(db: AnyRecord, sent: Sent, overrides: AnyRecord = {}): AnyRecord {
  return {
    prisma: db,
    io: {
      to() {
        return {
          emit(event: string) {
            sent.socketEvents.push(event);
          },
        };
      },
    },
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    contactUid: 'U-new-0001',
    channel: { id: 'channel-1', channelType: 'LINE' },
    conversation: { id: 'conv-1' },
    channelIdentity: {
      contactId: 'contact-1',
      contact: { displayName: '小明', phone: '0912345678', email: 'ming@example.com' },
    },
    now: new Date('2026-09-15T10:00:00Z'),
    isFirstContact: true,
    ...overrides,
  };
}

function freshSent(): Sent {
  return { messages: [], delivered: [], socketEvents: [] };
}

async function run() {
  // deliverToChannel 由參數注入（ESM module 物件唯讀，無法猴子補丁）
  const deliverCalls: string[] = [];
  let deliverShouldThrow = false;
  const fakeDeliver = (async (_p: unknown, _c: string, text: string) => {
    deliverCalls.push(text);
    if (deliverShouldThrow) throw new Error('channel send failed');
  }) as never;

  const { sendFirstContactGreeting } = await import('../modules/webhook/inbound-side-effects.js');

  // ── 1. 首次進站送出招呼語，且完成變數替換 ─────────────────────────────
  {
    const sent = freshSent();
    deliverCalls.length = 0;
    const db = createDb(sent, { greeting: '{{contact.name}} 您好，歡迎加入！' });

    await sendFirstContactGreeting(createCtx(db, sent) as never, fakeDeliver);

    assert.equal(sent.messages.length, 1, '應建立一則招呼訊息');
    assert.equal(sent.messages[0].direction, 'OUTBOUND');
    assert.equal(sent.messages[0].senderType, 'SYSTEM');
    assert.equal(
      sent.messages[0].metadata.source,
      'first_contact_greeting',
      'metadata 應標記來源，供日後追蹤與分析',
    );
    assert.equal(
      sent.messages[0].content.text,
      '小明 您好，歡迎加入！',
      '變數 {{contact.name}} 應被替換為聯絡人顯示名稱',
    );
    assert.equal(deliverCalls.length, 1, '應實際推送至渠道');
    assert.equal(deliverCalls[0], '小明 您好，歡迎加入！');
    assert.ok(sent.socketEvents.includes('message.new'), '應推播 message.new 給後台');
  }

  // ── 2. 非首次進站不送（每渠道每人只送一次）────────────────────────────
  {
    const sent = freshSent();
    deliverCalls.length = 0;
    const db = createDb(sent, { greeting: '歡迎！' });

    await sendFirstContactGreeting(createCtx(db, sent, { isFirstContact: false }) as never, fakeDeliver);

    assert.equal(sent.messages.length, 0, '非首次不得建立訊息');
    assert.equal(deliverCalls.length, 0, '非首次不得推送');
  }

  // ── 3. 未設定招呼語 → 不送（功能預設關閉）─────────────────────────────
  {
    const sent = freshSent();
    deliverCalls.length = 0;
    const db = createDb(sent, { greeting: null });

    await sendFirstContactGreeting(createCtx(db, sent) as never, fakeDeliver);

    assert.equal(sent.messages.length, 0, '未設定招呼語不得送出');
    assert.equal(deliverCalls.length, 0);
  }

  // ── 3b. 招呼語為空白字串 → 視同未設定 ─────────────────────────────────
  {
    const sent = freshSent();
    deliverCalls.length = 0;
    const db = createDb(sent, { greeting: '   ' });

    await sendFirstContactGreeting(createCtx(db, sent) as never, fakeDeliver);

    assert.equal(sent.messages.length, 0, '空白字串應視同未設定');
  }

  // ── 4. 推送失敗不得拋出（失敗隔離，CM-175 教訓）───────────────────────
  {
    const sent = freshSent();
    deliverCalls.length = 0;
    deliverShouldThrow = true;
    const db = createDb(sent, { greeting: '歡迎！' });

    await assert.doesNotReject(
      async () => sendFirstContactGreeting(createCtx(db, sent) as never, fakeDeliver),
      '推送渠道失敗時不得向外拋錯，否則會讓 inbound 訊息落地失敗',
    );

    deliverShouldThrow = false;
  }

  // ── 5. 變數解析不到時仍送出（不擋發送）────────────────────────────────
  {
    const sent = freshSent();
    deliverCalls.length = 0;
    const db = createDb(sent, { greeting: '{{contact.name}} 您好' });

    await sendFirstContactGreeting(
      createCtx(db, sent, { channelIdentity: { contactId: 'c', contact: undefined } }) as never,
      fakeDeliver,
    );

    assert.equal(sent.messages.length, 1, '變數無法解析時仍應送出訊息');
  }

  console.log('✔ first-contact-greeting：6 組情境全部通過（CM-176）');
}

run()
  .then(() => {
    // 與其他既有測試一致：明確退出，避免模組載入時建立的 Redis 連線讓程序掛住。
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
