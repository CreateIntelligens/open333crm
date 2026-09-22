## Why

UAT 正式環境的 LINE 收訊對「尚未建立 IdentityMap 的聯絡人」完全失效：webhook 進站、驗簽通過、訊息也解析成功，但在「把渠道 UID 解析成聯絡人」這一步整條鏈路崩潰，訊息不落地、聯絡人建不出來、前台收件匣什麼都看不到。

2026-09-15 於 UAT 實測重現（租戶「創造智能」`5f723a0b`，LINE 渠道 `bc64f7fc`）。應用層 log：

```
[Webhook] Signature OK
[Webhook] Parsed  count:1  contactUid: U2c1624e79002b40de…
[Webhook] LINE processing failed
TypeError: Cannot read properties of undefined (reading 'identityMap')
    at resolveUidToContact (packages/core/dist/identity/identity-stitcher.js:74:49)
    at resolveInboundContact (apps/api/dist/modules/webhook/inbound-contact-resolver.js:14:41)
    at async processInboundMessage (apps/api/dist/modules/webhook/webhook.service.js:99:5)
```

**根因**：`packages/core/package.json` 缺少 `"type": "module"`（`packages/database`、`packages/shared` 都有）。搭配 `tsconfig` 的 `module: NodeNext`，TypeScript 把 `packages/core` 編譯成 **CJS**（`require()` / `exports.`），而 `@open333crm/database` 是純 ESM。

於 UAT 容器（Node 24）實測確認精確行為：CJS `require()` 該 ESM 套件時，**`export * from '@prisma/client'` 的 135 個符號都正常取得，唯獨 `export { prisma } from './client.js'` 這個「轉出式 re-export」的符號遺失**（`Object.keys()` 中不存在 `prisma`）。直接 `require` 其 `dist/client.js` 則能正常取得 `prisma`。

因此 `import { prisma } from '@open333crm/database'` 被編成 `const database_1 = require("@open333crm/database")` 後，`database_1.prisma` 為 `undefined`，一存取 `.identityMap` 即 TypeError。

註：此行為與 Node 版本相關——本機 Node 22 的 `require(ESM)` 可正確取得該符號，UAT Node 24 則否。因此本問題在本機不易重現，只在正式環境爆發。

**為什麼平常沒被發現**：已有 `ChannelIdentity` 綁定的聯絡人走的是「直接命中既有身分」的快路徑，不會呼叫 `resolveUidToContact`。只有**尚未建立 IdentityMap 的 UID** 才會進到壞掉的程式碼——也就是**新客的第一則訊息**。同一時段，已綁定的帳號訊息正常落地，未綁定的帳號訊息全部靜默掉。

**為什麼難以察覺**：API 容器只把 HTTP 層 pino log 輸出到 stdout，應用層 `logger.*` 只寫進容器內 `/app/logs/app-YYYY-MM-DD.log`。`docker logs` 看不到任何錯誤，webhook 一律回 200，外部監控完全無感。

## What Changes

- **修正 `packages/core` 的模組格式**，使其與 `@open333crm/database`（ESM）相容，`identity-stitcher` 取得的 `prisma` 不再是 `undefined`。
- **`identity-stitcher` 改為由呼叫端注入 Prisma executor**，不再依賴套件層級的全域 `prisma` 單例。此舉同時修掉一個尚未爆發的租戶隔離問題：全域 `prisma` 未綁定租戶，在 Postgres RLS 下屬於 CM-171／CM-172 同一類病因（未綁租戶連線被 RLS 擋下或讀不到資料）。
- **補上防迴歸的守門**：針對「新 UID 首次進站」的整合測試，確保這條路徑日後不再靜默損壞。
- **應用層 log 輸出到 stdout**，讓 `docker logs` 能看到 webhook 處理鏈路的錯誤（本次排查繞路的根本原因）。

### 明確不做（本 change 範圍外）

- 首次進站招呼語／歡迎訊息（另案提案，且必須等本 change 修好後才有觸發時機）。
- `packages/core` 其他模組的 ESM 遷移副作用整理（若修正方式波及，於 tasks 內逐項處理，但不擴大重構）。
- FB App Development Mode 導致一般使用者訊息不觸發 webhook 的問題（屬 Meta 後台設定，非程式碼）。

## Capabilities

### New Capabilities
- `inbound-contact-resolution`: 定義 inbound webhook 將渠道 UID 解析為聯絡人的行為契約——既有身分命中、新 UID 首次進站、以及失敗時必須可觀測（不得靜默丟棄訊息）。

### Modified Capabilities
<!-- 無：本 change 修復既有行為使其符合原本即隱含的預期，不改動對外 API 或訊息語意。 -->

## Impact

- **`packages/core`**：`package.json` 補 `"type": "module"`；`src/identity/identity-stitcher.ts` 改為注入式 Prisma executor（7 處 `prisma.*` 呼叫）。因 core 產物格式由 CJS 轉 ESM，需驗證所有 consumer（apps/api、apps/workers）載入正常。
- **`apps/api`**：`src/modules/webhook/inbound-contact-resolver.ts` 傳入租戶綁定的 prisma；其他呼叫 `identity-stitcher` 的位置一併調整。
- **可觀測性**：logger transport 增加 stdout 輸出（保留既有檔案輸出與輪替）。
- **測試**：新增「新 UID 首次進站 → 建立聯絡人 + 落地訊息」整合測試。
- **資料**：無 schema 變更、無 migration。事故期間掉的訊息無法追回（LINE 不重送已回 200 的 webhook），但無髒資料殘留——聯絡人與訊息皆未建立。
- **部署**：修復後即生效，無需回填。
