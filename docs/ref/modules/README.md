# 模組文件

本目錄以**程式模組**為單位說明現況：`apps/api/src/modules/` 的每個模組屬於哪個後台、掛哪個路由前綴、需要什麼權限，以及個別模組的內部機制。系統的執行架構、部署與實作落差不在這裡，請看[系統總覽](../system/README.md)。

系統分成平台後台、租戶後台與對外端點三個面。判斷一個模組屬於哪一面，看它的 route 掛哪個 `authenticate`，不是看它放在哪個目錄——[模組總覽](./OVERVIEW.md)有完整說明。

想知道某個產品功能怎麼運作，例如收件匣、工單或方案，請看[功能區文件](../features/README.md)。那裡以功能區為單位，一份文件會跨好幾個模組。

## 本目錄的文件

| 文件 | 涵蓋範圍 | 適合解答的問題 |
| --- | --- | --- |
| [模組總覽](./OVERVIEW.md) | 全部模組 | 這個模組屬於哪個後台？掛哪個路由？對應哪個後台頁面？需要什麼權限？背景工作跑在哪個行程？ |
| [互動流程引擎](./CANVAS-FLOW-ENGINE.md) | `canvas` | 一條流程由哪些節點組成？停下來之後怎麼繼續？ |
| [權限計算](./PERMISSIONS.md) | `packages/core/src/rbac/`、`guards/rbac.guard.ts`、`services/permission.service.ts`、`services/channel-visibility.ts` | 有效權限怎麼算？改角色或方案多久生效？成員看得到哪些渠道？新增權限碼要做什麼？ |
| [事件與背景工作](./EVENTS.md) | `events/event-bus.ts`、各模組的 `*.worker.ts` 與 `*.scheduler.ts`、`apps/workers`、`plugins/socket.plugin.ts` 的 Redis 轉發 | 某個事件由誰發布、誰訂閱？工作送到哪個佇列？失敗會重試嗎？可以跑多個 API 行程嗎？ |
| [渠道外掛](./CHANNEL-PLUGINS.md) | `packages/channel-plugins`、`webhook`、各模組以 `channelType` 分支的程式 | 外掛要實作哪些方法？各渠道在哪個行程註冊？哪些功能沒有走外掛？新增渠道要做什麼？ |
| [認證與憑證](./AUTHENTICATION.md) | `auth`、`plugins/auth.plugin.ts`、`plugins/socket.plugin.ts`，以及各對外端點的驗證 | 系統有哪些憑證？路由該掛哪個認證裝飾器？停用或撤銷之後多久生效？ |

## 新增文件時

一個模組的內部機制複雜到總覽的一列講不完時，為它開一份文件，然後加進上面那張表。使用者看不到、但多個模組都依賴的機制（例如認證）也放在這裡。如果要說明的是使用者看得到的功能，而不是單一模組的內部機制，請放到[功能區文件](../features/README.md)。

文件內容以原始碼為準，開頭標明資料來源與核對日期，已知缺陷寫進[實作落差紀錄](../system/AUDIT.md)並在文件內以編號引用，不重複細節。
