/**
 * 自動化發券測試用的記憶體資料庫（add-coupon-system A15）。
 *
 * 只實作 workers 發券流程與 @open333crm/core 發券函式（issueInstances、confirmPendingInstance、
 * voidPendingInstance）會呼叫的 model 方法；core 的函式照常執行，不換成假的。
 * 查詢帶 tenantId 時都比對 tenantId：測試資料放兩個租戶時，漏帶 tenantId 的查詢會拿到別人的資料而讓斷言失敗。
 * （contactTag 表本身沒有 tenantId，以聯絡人區分。）
 * $transaction 與 Prisma 相同：callback 拋錯時還原交易內的所有寫入。
 */
import { createCipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { ChannelPlugin, OutboundPayload } from '@open333crm/channel-plugins';

// Workers 缺少金鑰時拒絕解密（credential-encryption），測試自己設定金鑰
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

export function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(process.env.CREDENTIAL_ENCRYPTION_KEY!, 'open333crm-credentials', 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

export const TENANT = 'a0000000-0000-4000-8000-000000000001';
export const OTHER_TENANT = 'b0000000-0000-4000-8000-000000000002';
export const COUPON_ID = 'c0000000-0000-4000-8000-000000000001';
export const RULE = { id: 'r0000000-0000-4000-8000-000000000001', name: '秋季領券' };

type Row = Record<string, any>;

interface Coupon extends Row {
  id: string;
  tenantId: string;
  name: string;
  status: string;
}

export interface FakeCouponDbOptions {
  channelType?: string;
  coupon?: Partial<Coupon>;
  /** 這位聯絡人在對話渠道沒有身分 */
  noIdentity?: boolean;
  /** 序號包的序號 */
  poolCodes?: string[];
  claimTag?: boolean;
}

export function fakeCouponDb(opts: FakeCouponDbOptions = {}) {
  const channelType = opts.channelType ?? 'LINE';
  const state = {
    coupons: [
      {
        id: COUPON_ID,
        tenantId: TENANT,
        name: '秋季九折',
        status: 'ACTIVE',
        couponType: 'DISCOUNT_PERCENT',
        discountAmount: null,
        discountPercent: 10,
        giftName: null,
        exchangeItem: null,
        minSpend: null,
        codeMode: opts.poolCodes ? 'IMPORTED_CODES' : 'UNIQUE_CODE',
        sharedCode: null,
        codePrefix: 'AUT',
        validityMode: 'FIXED',
        endAt: new Date('2099-12-31T15:59:59.999Z'),
        afterClaimDays: null,
        totalLimit: null,
        perContactLimit: 1,
        claimTagId: opts.claimTag ? 'tag-claimed' : null,
        claimTagTtlDays: null,
        ...opts.coupon,
      } as Coupon,
      // 其他租戶同 id 前綴的券：漏帶 tenantId 的查詢會撈到它
      { id: 'c0000000-0000-4000-8000-0000000000ff', tenantId: OTHER_TENANT, name: '別人的券', status: 'ACTIVE', perContactLimit: 9 } as Coupon,
    ],
    instances: [] as Row[],
    codes: (opts.poolCodes ?? []).map((code) => ({
      id: randomUUID(), tenantId: TENANT, couponId: COUPON_ID, code, status: 'AVAILABLE', instanceId: null as string | null, createdAt: new Date(),
    })),
    messages: [] as Row[],
    outbox: [] as Row[],
    contactTags: [] as Row[],
    tags: [{ id: 'tag-claimed', tenantId: TENANT, name: '已領秋季券', scope: 'CONTACT' }],
    conversations: [{ id: 'conv-1', tenantId: TENANT, contactId: 'contact-1', channelId: 'channel-1', channelType, lastMessageAt: null as Date | null }],
    channels: [{
      id: 'channel-1', tenantId: TENANT, channelType, isActive: true, settings: {},
      credentialsEncrypted: encryptCredentials({ channelAccessToken: 'line-token' }),
    }],
    identities: opts.noIdentity ? [] : [{ id: 'identity-1', contactId: 'contact-1', channelId: 'channel-1', uid: 'line-user-1' }],
    contacts: [{ id: 'contact-1', tenantId: TENANT }],
  };

  const byTenant = <T extends Row>(rows: T[], where: Row) => rows.filter((r) => !('tenantId' in where) || r.tenantId === where.tenantId);
  const tenantOk = (r: Row, where: Row) => where.tenantId === undefined || r.tenantId === where.tenantId;
  const pending = (r: Row, where: Row) =>
    where.deliveryPendingAt === undefined ? true : where.deliveryPendingAt?.not === null ? r.deliveryPendingAt != null : r.deliveryPendingAt === where.deliveryPendingAt;
  const matchInstance = (r: Row, where: Row) =>
    (where.id === undefined || r.id === where.id) &&
    (where.couponId === undefined || r.couponId === where.couponId) &&
    (where.contactId === undefined || r.contactId === where.contactId) &&
    (where.code === undefined || r.code === where.code) &&
    pending(r, where);

  const conversationView = (c: (typeof state.conversations)[number]) => {
    const channel = state.channels.find((ch) => ch.id === c.channelId)!;
    return {
      ...c,
      channel,
      contact: { channelIdentities: state.identities.filter((i) => i.contactId === c.contactId) },
    };
  };

  const db: Record<string, any> = {
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      // 交易失敗時還原：與真的 Prisma 交易相同，半途寫入的券、outbox、訊息都不留下（PR #364 審查）
      const snapshot = structuredClone(state);
      try {
        return await fn(db);
      } catch (err) {
        Object.assign(state, snapshot);
        throw err;
      }
    },
    // pg_advisory_xact_lock、SAVEPOINT：記憶體裡不需要
    async $executeRaw() { return 0; },
    async $executeRawUnsafe() { return 0; },
    // voidPendingInstance 的 SELECT ... FOR UPDATE：值依序為 instanceId、tenantId
    async $queryRaw(_strings: TemplateStringsArray, instanceId: string, tenantId: string) {
      return state.instances
        .filter((r) => r.id === instanceId && r.tenantId === tenantId && r.deliveryPendingAt != null)
        .map((r) => ({ id: r.id }));
    },
    coupon: {
      async findFirst({ where }: { where: Row }) {
        return state.coupons.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null;
      },
    },
    contact: {
      async findMany({ where }: { where: Row }) {
        return state.contacts.filter((c) => where.id.in.includes(c.id) && c.tenantId === where.tenantId).map((c) => ({ id: c.id }));
      },
    },
    conversation: {
      async findFirst({ where }: { where: Row }) {
        const c = state.conversations.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        return c ? conversationView(c) : null;
      },
      async findUnique({ where }: { where: Row }) {
        const c = state.conversations.find((x) => x.id === where.id && tenantOk(x, where));
        return c ? conversationView(c) : null;
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const c = state.conversations.find((x) => x.id === where.id && tenantOk(x, where));
        if (!c) throw new Error('Record to update not found');
        Object.assign(c, data);
        return c;
      },
      async updateMany({ where, data }: { where: Row; data: Row }) {
        const rows = byTenant(state.conversations, where).filter((x) => x.id === where.id);
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    channel: {
      async findFirst({ where }: { where: Row }) {
        return state.channels.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null;
      },
    },
    channelIdentity: {
      async findFirst({ where }: { where: Row }) {
        const contactOk = (contactId: string) =>
          !where.contact?.tenantId || state.contacts.some((c) => c.id === contactId && c.tenantId === where.contact.tenantId);
        return state.identities.find((i) => i.contactId === where.contactId && i.channelId === where.channelId && contactOk(i.contactId)) ?? null;
      },
    },
    couponInstance: {
      async count({ where }: { where: Row }) {
        return byTenant(state.instances, where).filter((r) => matchInstance(r, where)).length;
      },
      async findFirst({ where }: { where: Row }) {
        return byTenant(state.instances, where).find((r) => matchInstance(r, where)) ?? null;
      },
      async create({ data }: { data: Row }) {
        const row = { id: randomUUID(), deliveryPendingAt: null, issuedAt: new Date(), ...data };
        state.instances.push(row);
        return row;
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const row = state.instances.find((r) => r.id === where.id && tenantOk(r, where));
        if (!row) throw new Error('Record to update not found');
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: Row; data: Row }) {
        const rows = byTenant(state.instances, where).filter((r) => matchInstance(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      async deleteMany({ where }: { where: Row }) {
        const rows = byTenant(state.instances, where).filter((r) => matchInstance(r, where));
        state.instances = state.instances.filter((r) => !rows.includes(r));
        return { count: rows.length };
      },
    },
    couponCode: {
      async findFirst({ where }: { where: Row }) {
        return byTenant(state.codes, where).find((c) => c.couponId === where.couponId && c.status === where.status) ?? null;
      },
      async updateMany({ where, data }: { where: Row; data: Row }) {
        const rows = byTenant(state.codes, where).filter(
          (c) => (where.id === undefined || c.id === where.id) &&
            (where.status === undefined || c.status === where.status) &&
            (where.instanceId === undefined || c.instanceId === where.instanceId),
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    tag: {
      async findFirst({ where }: { where: Row }) {
        return state.tags.find((t) => t.id === where.id && t.tenantId === where.tenantId && t.scope === where.scope) ?? null;
      },
    },
    contactTag: {
      async findUnique({ where }: { where: Row }) {
        const k = where.contactId_tagId;
        return state.contactTags.find((t) => t.contactId === k.contactId && t.tagId === k.tagId) ?? null;
      },
      async upsert({ where, create }: { where: Row; create: Row }) {
        const k = where.contactId_tagId;
        const existing = state.contactTags.find((t) => t.contactId === k.contactId && t.tagId === k.tagId);
        if (existing) return existing;
        state.contactTags.push(create);
        return create;
      },
    },
    message: {
      async create({ data }: { data: Row }) {
        const row = { id: randomUUID(), createdAt: new Date(), ...data };
        state.messages.push(row);
        return row;
      },
    },
    outbox: {
      async create({ data }: { data: Row }) {
        const row = { id: randomUUID(), ...data, queueName: null, jobOptions: null, createdAt: new Date() };
        state.outbox.push(row);
        return row;
      },
      async updateMany() { return { count: 1 }; },
    },
    sideEffectClaim: { async createMany() { return { count: 1 }; } },
  };
  return { db, state };
}

/** 記錄送出內容的 LINE 外掛；reject 為 true 時渠道拒收（例如顧客封鎖） */
export function fakeLinePlugin(behavior: { reject?: string | false; replyFails?: boolean } = {}) {
  const sends: OutboundPayload[] = [];
  const plugin: ChannelPlugin = {
    channelType: 'LINE',
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (_to, payload) => {
      sends.push(payload);
      if (behavior.reject) return { success: false, error: behavior.reject };
      if (behavior.replyFails && payload.content.strategy === 'reply') return { success: false, error: 'Invalid reply token' };
      return { success: true, channelMsgId: `line-msg-${sends.length}` };
    },
  };
  return { plugin, sends };
}

/** 記錄 socket 事件與票券連結的假 Redis */
export function fakeRedis() {
  const events: Array<{ room: string; event: string; data: any }> = [];
  const kv = new Map<string, string>();
  const redis = {
    async publish(channel: string, payload: string) {
      if (channel === 'socket:emit') events.push(JSON.parse(payload));
      return 1;
    },
    async set(key: string, value: string) {
      kv.set(key, value);
      return 'OK';
    },
    async get(key: string) {
      return kv.get(key) ?? null;
    },
  };
  return { redis, events };
}
