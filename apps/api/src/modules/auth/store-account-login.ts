/**
 * 門市帳號登入前的跨租戶查詢（add-coupon-system design D13）。
 *
 * 登入時只有帳號名稱，還不知道租戶，RLS 下的連線看不到任何帳號——比照座席以 email 全域解析租戶，
 * 這裡用 BYPASSRLS 連線（prismaAdmin，本目錄在白名單內）**只查出租戶與門市名稱**，
 * 密碼比對、錯誤次數與鎖定都回到 withTenant 的連線處理。
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/** 帳號名稱所屬的租戶；查無或已刪除回 null */
export async function resolveStoreAccountTenant(prismaAdmin: PrismaClient, username: string): Promise<string | null> {
  const row = await prismaAdmin.storeAccount.findUnique({
    where: { username },
    select: { tenantId: true, deletedAt: true },
  });
  return row && !row.deletedAt ? row.tenantId : null;
}

/** 核銷台登入頁依網址上的門市 id 顯示門市名稱（海報 QR 帶門市 id，不帶任何憑證） */
export async function findPublicStoreName(prismaAdmin: PrismaClient, storeId: string): Promise<string | null> {
  const store = await prismaAdmin.store.findUnique({ where: { id: storeId }, select: { name: true } });
  return store?.name ?? null;
}

/** 給核銷台路由用：綁好 BYPASSRLS 連線的查詢函式，路由本身不直接使用 prismaAdmin */
export function storeLoginLookups(app: FastifyInstance) {
  return {
    resolveTenant: (username: string) => resolveStoreAccountTenant(app.prismaAdmin, username),
    publicStoreName: (storeId: string) => findPublicStoreName(app.prismaAdmin, storeId),
  };
}
