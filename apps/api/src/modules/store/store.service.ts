/**
 * 門市與門市帳號管理（後台，add-coupon-system design D13）。
 *
 * 租戶隔離：所有函式收 TenantDb（已綁租戶的連線），並仍帶 where tenantId。
 * 回應一律不含密碼雜湊。
 */
import { Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { hashPassword } from '../../shared/utils/password.js';

/** 欄位格式錯誤，route 轉 400 */
export class StoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreValidationError';
  }
}

/** 與既有資料衝突（帳號名稱重複），route 轉 409 */
export class StoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

/** 帳號名稱：英文小寫、數字與連字號，3–32 字（店員要在手機上輸入，避免大小寫與特殊字元） */
const USERNAME_PATTERN = /^[a-z0-9-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

const ACCOUNT_SELECT = {
  id: true,
  storeId: true,
  username: true,
  canRedeem: true,
  isActive: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export type StoreAccountView = Prisma.StoreAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new StoreValidationError(`密碼至少 ${MIN_PASSWORD_LENGTH} 個字`);
  }
}

/** 門市列表，含各門市未刪除的帳號（不含密碼雜湊） */
export async function listStores(db: TenantDb, tenantId: string) {
  return db.store.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    include: {
      accounts: { where: { tenantId, deletedAt: null }, select: ACCOUNT_SELECT, orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function getStore(db: TenantDb, tenantId: string, id: string) {
  return db.store.findFirst({ where: { id, tenantId } });
}

export async function createStore(db: TenantDb, tenantId: string, input: { name: string }) {
  const name = input.name.trim();
  if (!name) throw new StoreValidationError('請填寫門市名稱');
  return db.store.create({ data: { tenantId, name } });
}

/** 改名或設定停業／恢復營業。停業的門市不能核銷，已登入的裝置下一次操作就會被擋。 */
export async function updateStore(db: TenantDb, tenantId: string, id: string, input: { name?: string; isActive?: boolean }) {
  const data: Prisma.StoreUpdateManyMutationInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new StoreValidationError('請填寫門市名稱');
    data.name = name;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  const result = await db.store.updateMany({ where: { id, tenantId }, data });
  if (result.count === 0) return null;
  return getStore(db, tenantId, id);
}

/**
 * 建立門市帳號。帳號名稱在所有租戶間不可重複——其他租戶的帳號在 RLS 下看不到，
 * 只能靠唯一索引擋下，再轉成可讀的訊息。
 */
export async function createStoreAccount(
  db: TenantDb,
  tenantId: string,
  input: { storeId: string; username: string; password: string; canRedeem?: boolean },
): Promise<StoreAccountView> {
  const username = input.username.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new StoreValidationError('帳號名稱只能使用英文小寫、數字與連字號，3–32 字');
  }
  assertPassword(input.password);
  const store = await db.store.findFirst({ where: { id: input.storeId, tenantId }, select: { id: true } });
  if (!store) throw new StoreValidationError('查無此門市');

  try {
    return await db.storeAccount.create({
      data: {
        tenantId,
        storeId: store.id,
        username,
        passwordHash: await hashPassword(input.password),
        canRedeem: input.canRedeem ?? true,
      },
      select: ACCOUNT_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new StoreConflictError('此帳號名稱已被使用');
    }
    throw err;
  }
}

async function updateAccount(db: TenantDb, tenantId: string, id: string, data: Prisma.StoreAccountUpdateManyMutationInput) {
  const result = await db.storeAccount.updateMany({ where: { id, tenantId, deletedAt: null }, data });
  if (result.count === 0) return null;
  return db.storeAccount.findFirst({ where: { id, tenantId }, select: ACCOUNT_SELECT });
}

/** 開關核銷權限、停用或啟用帳號 */
export function updateStoreAccount(db: TenantDb, tenantId: string, id: string, input: { canRedeem?: boolean; isActive?: boolean }) {
  const data: Prisma.StoreAccountUpdateManyMutationInput = {};
  if (input.canRedeem !== undefined) data.canRedeem = input.canRedeem;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return updateAccount(db, tenantId, id, data);
}

/** 重設密碼：舊的登入全部失效（PASSWORD_CHANGED），並解除鎖定 */
export async function resetStoreAccountPassword(db: TenantDb, tenantId: string, id: string, password: string) {
  assertPassword(password);
  return updateAccount(db, tenantId, id, {
    passwordHash: await hashPassword(password),
    passwordVersion: { increment: 1 },
    failedLoginCount: 0,
    lockedUntil: null,
  });
}

/** 強制登出：這個帳號在所有裝置的登入都失效（SESSION_REVOKED） */
export function forceLogoutStoreAccount(db: TenantDb, tenantId: string, id: string) {
  return updateAccount(db, tenantId, id, { sessionVersion: { increment: 1 } });
}

/** 刪除帳號：保留紀錄並標記刪除，已登入的裝置得知「找不到此門市帳號」 */
export async function deleteStoreAccount(db: TenantDb, tenantId: string, id: string): Promise<boolean> {
  const result = await db.storeAccount.updateMany({
    where: { id, tenantId, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false },
  });
  return result.count > 0;
}
