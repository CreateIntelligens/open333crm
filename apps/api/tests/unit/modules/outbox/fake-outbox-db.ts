/**
 * outbox 排程測試用的假資料庫：資料列放在記憶體，只支援排程用到的查詢條件。
 */
type Where = {
  id?: { in: string[] };
  dispatchedAt?: null | { lt: Date };
  createdAt?: { lt: Date };
};

export interface FakeRow {
  id: string;
  tenantId: string;
  kind: string;
  name: string;
  queueName: string | null;
  payload: unknown;
  jobOptions: unknown;
  createdAt: Date;
  dispatchedAt: Date | null;
}

function matches(row: { createdAt: Date; dispatchedAt?: Date | null; id: string }, where: Where): boolean {
  if (where.id && !where.id.in.includes(row.id)) return false;
  if (where.dispatchedAt === null && row.dispatchedAt != null) return false;
  if (where.dispatchedAt && !(row.dispatchedAt && row.dispatchedAt < where.dispatchedAt.lt)) return false;
  if (where.createdAt && !(row.createdAt < where.createdAt.lt)) return false;
  return true;
}

export function fakeOutboxDb(outbox: FakeRow[], claims: Array<{ id: string; createdAt: Date }> = []) {
  return {
    outbox: {
      async findMany(args: { where: Where; take?: number }) {
        return outbox.filter((r) => matches(r, args.where)).slice(0, args.take ?? Infinity);
      },
      async updateMany(args: { where: Where; data: { dispatchedAt: Date } }) {
        const hit = outbox.filter((r) => matches(r, args.where));
        for (const r of hit) r.dispatchedAt = args.data.dispatchedAt;
        return { count: hit.length };
      },
      async deleteMany(args: { where: Where }) {
        const keep = outbox.filter((r) => !matches(r, args.where));
        const count = outbox.length - keep.length;
        outbox.splice(0, outbox.length, ...keep);
        return { count };
      },
    },
    sideEffectClaim: {
      async deleteMany(args: { where: Where }) {
        const keep = claims.filter((r) => !matches(r, args.where));
        const count = claims.length - keep.length;
        claims.splice(0, claims.length, ...keep);
        return { count };
      },
    },
  };
}
