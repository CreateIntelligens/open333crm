/**
 * RLS 租戶注入機制（add-postgres-rls 的心臟）。
 *
 * 多租戶隔離除 app-layer（每 query where tenantId）外，再加 Postgres RLS 作 DB 層強制。
 * RLS policy 依 session 變數 `app.current_tenant` 過濾；本檔負責「安全地把 tenantId 注入連線」。
 *
 * 安全性核心：用「交易內 SET LOCAL（set_config is_local=true）」——值只在該交易有效，
 * COMMIT/ROLLBACK 後自動失效，連線歸還池不可能殘留到下個請求/租戶（不依賴應用紀律）。
 * 已用 POC 驗證：交易內生效、交易外讀不到。
 */
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 在綁定租戶身分的交易內執行 fn。fn 收到的 tx 已設好 app.current_tenant，
 * 其所有 query 都受 RLS 約束到該租戶。tenantId 先驗 UUID（雙保險，防注入）。
 *
 * ⚠️ fn 內 MUST 用傳入的 tx（同交易=同連線=session 變數有效）；用外層 prisma 會落到
 * 別的連線、變數為 NULL → fail-closed 讀不到資料（會立刻被測出，這是好事）。
 */
export function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`withTenant: 不合法的 tenantId「${tenantId}」`);
  }
  return prisma.$transaction(async (tx) => {
    // set_config(name, value, is_local=true) 等同 SET LOCAL，但可參數化（SET LOCAL 不吃佔位符）
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * 建立「租戶綁定」的 Prisma client（$extends）：對其發出的每個 model 操作都自動包進
 * withTenant 交易並在該交易內重發，讓實際 query 落在設好 app.current_tenant 的同一連線。
 * request handler 照舊呼叫（如 prisma.contact.findMany），底層自動綁定——對既有 route 侵入最小。
 *
 * ⚠️ 關鍵：不可用 $allOperations 的 `query(args)`（它會跳出我們的交易、落到別的連線 →
 * set_config 讀不到、fail-closed 回空）。改為在 withTenant 的 tx 上以
 * `tx[model][operation](args)` 重發，確保同交易同連線。已用 POC 對真實 RLS 驗證生效。
 *
 * raw query（$queryRaw/$executeRaw 及 Unsafe 版）另以 client-level 覆寫包進 withTenant，
 * 讓 raw 也在設好 app.current_tenant 的交易內執行（否則 raw 落 base 連線、FORCE 下 fail-closed
 * 回空或轉型失敗）。已 POC 驗證：覆寫後 raw query 正確走到租戶。
 */
export function tenantScopedClient(base: PrismaClient, tenantId: string) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args }) {
          return withTenant(base, tenantId, async (tx) => {
            // model 為 PascalCase（Contact），交易 client 上是 camelCase（contact）
            const key = model.charAt(0).toLowerCase() + model.slice(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (tx as any)[key][operation](args);
          });
        },
      },
    },
    client: {
      // 覆寫 raw query，使其在綁定租戶的交易內執行（tx 上重發同名方法）。
      // 保留泛型 <T>，讓呼叫端 $queryRaw<{...}[]> 的回傳型別不退化為 unknown。
      /* eslint-disable @typescript-eslint/no-explicit-any */
      $queryRaw<T = unknown>(this: any, ...a: any[]): Promise<T> {
        return withTenant(base, tenantId, (tx: any) => (tx.$queryRaw as any)(...a)) as Promise<T>;
      },
      $queryRawUnsafe<T = unknown>(this: any, ...a: any[]): Promise<T> {
        return withTenant(base, tenantId, (tx: any) => (tx.$queryRawUnsafe as any)(...a)) as Promise<T>;
      },
      $executeRaw(this: any, ...a: any[]): Promise<number> {
        return withTenant(base, tenantId, (tx: any) => (tx.$executeRaw as any)(...a)) as Promise<number>;
      },
      $executeRawUnsafe(this: any, ...a: any[]): Promise<number> {
        return withTenant(base, tenantId, (tx: any) => (tx.$executeRawUnsafe as any)(...a)) as Promise<number>;
      },
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
  });
}

export type TenantScopedClient = ReturnType<typeof tenantScopedClient>;

/**
 * service 層 prisma 參數的共用型別：可接受一般 PrismaClient、交易 client、或租戶綁定的
 * extended client。三者對 model 操作（findMany/create/update…）簽名一致；不含 $transaction
 * 等頂層方法，故用此型別的 service MUST 只用 model 操作。
 * 需要 $transaction 的 service 仍收 PrismaClient（走 withTenant 或 admin 連線）。
 */
export type TenantDb = PrismaClient | Prisma.TransactionClient | TenantScopedClient;
