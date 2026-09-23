## Context

`packages/core` 缺少 `"type": "module"`，被編譯成 CJS；它 `require()` 的 `@open333crm/database` 是純 ESM，因此所有從 database 取得的具名匯出在執行期皆為 `undefined`。

盤點 `packages/core/src` 內從 `@open333crm/database` 匯入的檔案：

| 檔案 | prisma 呼叫數 | 是否有 consumer |
|---|---:|---|
| `identity/identity-stitcher.ts` | 7 | **是** — `resolveUidToContact` 被 `apps/api` 匯入 |
| `contacts/contact-service.ts` | 11 | 否（無人從 core 匯入其符號）|
| `inbox/inbox-service.ts` | 4 | 否 |
| `identity/merge-suggestion-service.ts` | 6 | 否 |
| `canvas/flow-runner.ts` | 6 | 否 |

實測確認：`apps/api` / `apps/workers` 從 `@open333crm/core` 匯入的符號中，唯一觸及上述檔案的是 **`resolveUidToContact`**。其餘四個檔案目前無 consumer（死碼），因此本 change 以 `identity-stitcher` 為修復標的，其餘檔案僅需隨模組格式修正而不破壞編譯。

## Goals / Non-Goals

**Goals**
- 新 UID 首次進站能正確建立聯絡人並落地訊息。
- 失敗必須可觀測——不得再出現「webhook 回 200、訊息消失、`docker logs` 無痕跡」。
- 順手修掉 `identity-stitcher` 使用未綁租戶全域 prisma 的隱患（RLS 風險，同 CM-171／CM-172 病因）。

**Non-Goals**
- 不重構 core 其餘模組，不處理四個死碼檔案的商業邏輯。
- 不做首次進站招呼語（另案）。
- 不追回事故期間掉失的訊息（LINE 對已回 200 的 webhook 不重送）。

## Decisions

### D1：修 `packages/core` 的模組格式 — 補 `"type": "module"`

與 `packages/database`、`packages/shared` 一致（兩者皆已是 ESM）。`packages/core` 的 `tsconfig` 已是 `module: NodeNext`，補上 `"type": "module"` 後即輸出 ESM，`import { prisma }` 得到真正的具名匯出。

**替代方案（否決）**
- *把 `@open333crm/database` 改成 dual CJS/ESM*：影響面更大，且與 monorepo 其餘套件皆為 ESM 的方向背道而馳。
- *在 `identity-stitcher` 改用 `createRequire` 或動態 `import()`*：治標，其餘四個檔案仍是壞的，且掩蓋了真正的設定缺失。

**風險**：core 產物由 CJS 轉 ESM，consumer（`apps/api`、`apps/workers`、`packages/channel-plugins`）的載入方式須驗證。三者皆已是 ESM，預期相容；tasks 內含逐一驗證步驟。相對匯入需補副檔名（`.js`），`NodeNext` 會在編譯期報錯，可據此逐一修正。

### D2：`identity-stitcher` 改為注入式 Prisma executor

即使 D1 修好模組格式，套件層級的全域 `prisma` 仍是未綁租戶的連線。在 Postgres RLS 下，這正是 CM-171／CM-172「功能靜默失效」的病因。

因此 `resolveUidToContact` 等函式改為第一參數接收 `PrismaExecutor`（比照 `tagging.service.ts` 的既有慣例——該服務已被 5 個模組跨模組呼叫，證明此模式穩定），由呼叫端 `inbound-contact-resolver.ts` 傳入租戶綁定的 prisma。

此舉讓 D1 即使未來被回退，這條路徑也不再依賴全域單例。

### D3：AGENTS.md 的既有規則需要修正

`openspec/config.yaml` 與 `AGENTS.md` 目前寫著「Import PrismaClient from `@open333crm/database`, not `@prisma/client`」。該規則正是本次事故的成因之一，且與專案記憶中「ESM re-export of CJS fails」的既有踩坑紀錄矛盾。

本 change 於文件中補充限定條件：**套件內部不得依賴 `@open333crm/database` 的全域 `prisma` 單例**；需要 DB 存取的共用函式一律由呼叫端注入 executor。

### D4：應用層 log 輸出到 stdout —— 屬部署設定，非程式碼缺陷

排查初期判斷為 logger 程式碼缺少 stdout transport。實際檢視 `packages/core/src/logger/index.ts` 後確認**程式碼本身已支援三種模式**（`console` / `file` / `both`，由 `LOG_TRANSPORT` 控制，預設 `console`）。

真正原因是 **UAT 部署將 `LOG_TRANSPORT` 設為 `file`**（已於容器內實測確認），導致應用層 log 只寫進 `/app/logs/app-YYYY-MM-DD.log`，`docker logs` 只剩 HTTP 層 pino log。本次事故的錯誤堆疊完整存在於檔案中，卻在容器外不可見。

**決定**：不改 logger 程式碼，改為調整部署設定 `LOG_TRANSPORT=both`（保留檔案輸出與輪替，同時輸出 stdout）。此項列為部署任務而非程式碼任務。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| core 轉 ESM 波及其他 consumer | 三個 consumer 皆已是 ESM；`NodeNext` 在編譯期即報錯，不會留到執行期；tasks 含逐一驗證 |
| 四個死碼檔案在轉換後編譯失敗 | 它們無 consumer，必要時可暫時排除於編譯或標記 deprecated，不阻塞主修復 |
| stdout log 量過大 | 沿用既有 log level 設定，不調降門檻；僅改輸出目的地 |

## Migration Plan

無 schema 變更、無資料回填。部署後即生效。

事故期間（2026-09-15 01:54 起）掉失的訊息無法追回，但**無髒資料殘留**——聯絡人與訊息皆未建立，修復後該使用者再次發訊息即正常建檔。

## Open Questions

- 四個無 consumer 的檔案（contact-service／inbox-service／merge-suggestion-service／flow-runner）是否應在後續 change 中移除或補上 consumer？本 change 僅確保其不阻塞編譯，不做去留決策。
