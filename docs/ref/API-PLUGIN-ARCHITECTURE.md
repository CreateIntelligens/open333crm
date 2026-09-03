# API 外掛架構 — apps/api 的設計模式

本文件說明 `apps/api` 採用的架構模式。內容分三部分：Fastify 5 的外掛機制包含哪些設計模式、每一層模式解決什麼問題、這個寫法帶來哪些限制。

- **資料來源**：`apps/api/src/index.ts`、`apps/api/src/plugins/*.ts`、`apps/api/src/modules/*/*.routes.ts`
- **圖表格式**：Mermaid 的 `flowchart` 與 `sequenceDiagram`。GitHub 直接渲染，讀者不需要安裝額外工具。
- **與其他文件的分工**：
  - 系統整體結構請看 [`system/README.md`](./system/README.md)。
  - 多租戶與 RLS 的接線規則請看 [`../../AGENTS.md`](../../AGENTS.md) 與 `postgres-rls-tenant-isolation` skill。
  - 本文件只談**架構模式**，不重複那兩份的內容。

---

## 四層模式總覽

Fastify 的外掛機制不是單一一種模式，而是四層模式組合而成。這四層都出現在 `apps/api`：

| 層  | 模式                              | 在程式碼中的體現                                              |
| --- | --------------------------------- | ------------------------------------------------------------- |
| 1   | 微核心架構（Microkernel）         | `bootstrap()` 依序 `register()` 7 個基礎設施 plugin           |
| 2   | 控制反轉（IoC）                   | plugin 交出函式，由 Fastify 決定執行與清理時機                |
| 3   | 服務定位器（Service Locator）     | `fastify.decorate()` 掛依賴，handler 用 `fastify.prisma` 取用 |
| 4   | 封裝情境（Encapsulation Context） | `register()` 建立子作用域；`fastify-plugin` 打破封裝          |

另外還有兩個區域性的模式：hook 管線是**責任鏈**，`request.tenantPrisma` 的 getter 是**虛擬代理**。

---

## 第 1 層 — 微核心架構

Fastify 核心只提供路由與生命週期，其他能力全部由外掛提供。核心不包含任何具體功能，各項功能反過來註冊進核心。

`apps/api/src/index.ts` 的 `bootstrap()` 就是組裝過程。註冊順序如下：

```mermaid
flowchart LR
  core["Fastify 核心<br/>路由 + 生命週期"] --> m["multipart<br/>檔案上傳 25MB"]
  m --> cors["cors"]
  cors --> eh["error-handler<br/>setErrorHandler"]
  eh --> pr["prisma<br/>兩條資料庫連線"]
  pr --> ck["cookie"]
  ck --> au["auth<br/>JWT 與 5 種驗證器"]
  au --> so["socket<br/>Socket.IO 與 Redis 訂閱"]
  so --> cb["chatbox"]
  cb --> routes["42 個路由模組"]
```

---

## 第 2 層 — 控制反轉

外掛不呼叫框架，外掛把函式交給框架，由框架決定何時執行。`prisma.plugin.ts` 是最完整的例子：

```ts
async function prismaPlugin(fastify: FastifyInstance) {
  await prisma.$connect(); // 啟動時執行，時機由 Fastify 決定
  fastify.decorate("prisma", prisma);
  fastify.addHook("onClose", async () => {
    // 關閉時執行，由 Fastify 回呼
    await prisma.$disconnect();
  });
}
```

這段程式不決定連線與斷線的時機。外掛只宣告在這兩個時間點要執行什麼動作。

---

## 第 3 層 — 服務定位器

`fastify.decorate(名稱, 值)` 把依賴掛到實例上。handler 透過 `fastify.prisma` 取用，而不是 `import` 一個模組層級的單例。

### 七個 plugin 各自裝飾了什麼

| plugin          | 裝飾到 instance                                                   | 裝飾到 request          | 其他作用                                             |
| --------------- | ----------------------------------------------------------------- | ----------------------- | ---------------------------------------------------- |
| `cors`          | 無                                                                | 無                      | 註冊 `@fastify/cors`                                 |
| `error-handler` | 無                                                                | 無                      | `setErrorHandler`                                    |
| `prisma`        | `prisma`、`prismaAdmin`                                           | `tenantPrisma`          | `onRequest` 掛 getter；`onClose` 斷線                |
| `cookie`        | 無                                                                | 無                      | 註冊 `@fastify/cookie`                               |
| `auth`          | `authenticate` 等 5 個驗證器                                      | `agent`、`platformUser` | 註冊 `@fastify/jwt`                                  |
| `socket`        | `io`                                                              | 無                      | 訂閱 `socket:emit` 與 `domain:event`；`onClose` 收尾 |
| `chatbox`       | `chatboxMessageRegistry`、`chatboxI18n`、`chatboxSessionVerifier` | 無                      | 無                                                   |

### 依賴的取得方向

`apps/api` 的程式不是被動接收依賴，而是主動從實例上按名字取用：

```ts
const rows = await fastify.prisma.case.findMany(...);  // 從 root 實例取
const db = request.tenantPrisma;                       // 從當前 request 取
```

這個方向帶來一個具體後果：**漏註冊要到執行期才會發現**。假如 `prisma` plugin 沒有註冊，`fastify.prisma` 的值就是 `undefined`，錯誤會在第一次查詢時才出現，不會在 `bootstrap()` 階段出現。下一節的做法補上編譯期的檢查。

### 型別安全靠 declaration merging 補回

服務定位器無法在編譯期檢查出漏註冊。Fastify 用 TypeScript 的介面合併補上這項檢查。每個 plugin 頂端都有一段：

```ts
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    prismaAdmin: PrismaClient;
  }
}
```

這是**型別層的 decorate**，與執行期的 `decorate()` 成對出現。只寫其中一邊會產生兩種錯誤之一：只寫型別會通過編譯，但執行時取到 `undefined`；只寫執行期則無法通過型別檢查。

---

## 第 4 層 — 封裝情境

這一層決定了 `apps/api` 每個 hook 的作用範圍。

`register()` 建立一個**子實例**，子實例用原型鏈繼承父實例。在子實例上註冊的裝飾，父實例與兄弟實例讀不到。`fastify-plugin`（慣例縮寫 `fp`）的作用是**打破這層封裝**，把裝飾提升到父層。

`apps/api` 把外掛分成兩類，兩類的處理方式不同：

|                 | 是否包 `fp` | 數量 | 效果                        |
| --------------- | ----------- | ---- | --------------------------- |
| 基礎設施 plugin | 全部包      | 7    | 裝飾提升到 root，全域可用   |
| 路由模組        | 全部不包    | 42   | 各自獨立作用域，hook 不外洩 |

```mermaid
flowchart TD
  root["root instance<br/>bootstrap() 建立"]
  root -->|"register 並包 fp<br/>裝飾提升到 root"| infra["7 個基礎設施 plugin<br/>prisma / auth / socket / chatbox ..."]
  root -->|"register 加 prefix<br/>建立子作用域"| m1["caseRoutes<br/>/api/v1/cases"]
  root -->|"register 加 prefix"| m2["contactRoutes<br/>/api/v1/contacts"]
  root -->|"register 加 prefix"| m3["其餘 40 個路由模組"]
  infra -.->|"子作用域沿原型鏈讀得到"| m1
  infra -.-> m2
  infra -.-> m3
  m1 -.-x|"hook 不會外洩到兄弟作用域"| m2
```

`case.routes.ts` 的這一行示範封裝情境的實際用途：

```ts
export default async function caseRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  // ...
}
```

這個 `preHandler` **只作用在本模組的路由上**，不會影響 `/api/v1/contacts`。全專案有 34 個路由模組用這個寫法各自掛驗證。如果路由模組也包了 `fp`，這些 hook 會全部提升到 root，變成每一條路由都要驗證，包括本來就該公開的 webhook 端點。

「基礎設施包 `fp` 提升到 root，路由模組不包 `fp` 保持隔離」這個分工，讓基礎設施在全域可用，同時讓每個路由模組的 hook 維持在自己的作用域內。

---

## 請求的生命週期

下圖把上述四層合起來，畫出一個請求的完整路徑。閱讀重點是 `tenantPrisma` 的建立時機：

```mermaid
sequenceDiagram
    autonumber
    participant C as 用戶端
    participant R as root instance
    participant M as 路由模組作用域
    participant H as handler
    participant DB as PostgreSQL

    C->>R: HTTP 請求
    R->>R: onRequest — prisma plugin 掛上 tenantPrisma 的 getter
    Note over R: 此時 request.agent 還不存在
    R->>M: 依 prefix 交給對應的子作用域
    M->>M: preHandler — 執行該模組的 fastify.authenticate
    Note over M: 驗證通過後才寫入 request.agent
    M->>H: 執行 handler
    H->>H: 第一次讀取 request.tenantPrisma
    Note over H: getter 此時才依 request.agent.tenantId 建立 client
    H->>DB: 在交易內 SET LOCAL app.current_tenant
    DB-->>H: RLS 只回傳該租戶的資料列
    H-->>C: 回應
```

---

## 兩個區域性模式

### 責任鏈 — hook 管線

`onRequest` → `preHandler` → handler → `onSend` → `onResponse` 是一條責任鏈。`apps/api` 用到其中三個位置：`prisma` 在 `onRequest` 掛 `tenantPrisma` 的 getter，34 個路由模組在 `preHandler` 掛各自的驗證器，`prisma` 與 `socket` 在 `onClose` 收尾。

### 虛擬代理 — `tenantPrisma` 的延遲建立

`prisma.plugin.ts` 的 `onRequest` hook 早於 `auth` 的 `preHandler`，掛 hook 的當下 `request.agent` 還不存在。解法是掛一個 getter，把建立時機延後到第一次取用：

```ts
Object.defineProperty(request, "tenantPrisma", {
  configurable: true,
  get() {
    const tid = request.agent?.tenantId;
    if (!tid) throw new Error("tenantPrisma 需要已認證的租戶身分");
    return tenantScopedClient(prisma, tid);
  },
});
```

這是虛擬代理模式：物件在第一次被存取之前不建立。這個寫法達成兩件事。第一，它繞開註冊順序造成的時間差。第二，未認證的路徑在取用時會明確拋錯，不會取得一個沒有租戶約束的 client。

---

## 這個寫法的取捨

### 全域裝飾讓 `prismaAdmin` 在每個檔案都可呼叫

7 個基礎設施 plugin 全部包了 `fp`，所有裝飾都提升到 root。對單體 API 而言這是合理選擇，否則每個路由模組都要重新註冊資料庫連線。

代價是 `declare module 'fastify'` 的型別增補也是全域的。因此**每一個**檔案都讀得到 `fastify.prismaAdmin`，也都可以呼叫它，而這是一條 `BYPASSRLS` 的連線。型別系統無法限制這個呼叫。

這正是 `scripts/check-prisma-admin-usage.mjs` 必須存在的原因：架構上無法限制的用法，只能用自訂檢查在 CI 擋下。這個檢查在 `.github/workflows/ci.yml` 以 `--strict` 執行，非白名單檔案使用 `prismaAdmin` 會讓建置失敗。

### 相依宣告不一致

`fastify-plugin` 支援 `dependencies` 選項，用來宣告「本外掛需要哪個外掛先註冊」。目前只有一個外掛用了：

| plugin    | 是否用到其他 plugin 的裝飾 | 是否宣告 `dependencies` |
| --------- | -------------------------- | ----------------------- |
| `chatbox` | 用 `fastify.prisma`        | 是，宣告 `['prisma']`   |
| `auth`    | 用 `fastify.prismaAdmin`   | **否**                  |
| 其餘 5 個 | 沒有用到                   | 不需要                  |

兩者的用法相同，都是在 handler 閉包內取用，執行時機在請求階段，不在註冊階段。因此即使調換註冊順序，兩者都不會在啟動時失敗。差別只在 `chatbox` 多一層防護：如果有人移除 `prisma` plugin，`chatbox` 會在啟動時就報錯，`auth` 則要等到第一個帶 CLI token 或 partner key 的請求進來才失敗。

在 `auth.plugin.ts` 補上 `dependencies: ['prisma']` 可以讓兩者一致，代價是一行程式碼。

### 註冊順序目前靠 `index.ts` 的呼叫順序維持

由於只有一個外掛宣告相依，實際順序完全取決於 `bootstrap()` 裡 `register()` 的先後。這段順序有三個理由：

1. `error-handler` 要早於任何會拋錯的外掛，否則錯誤不會被統一處理。
2. `prisma` 要早於任何用到資料庫的外掛。
3. `auth` 要早於任何需要身分的外掛。

這三個理由目前只寫在本文件，程式碼中沒有記錄。
