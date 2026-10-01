# 粉絲活動

粉絲活動讓租戶在 LINE 裡辦投票、表單與問答。管理員在後台建立活動、發布、查看提交紀錄並抽獎；粉絲在 LINE 內開啟活動頁參加，參加後可以累積積分。

- **資料來源**：`apps/api/src/modules/portal/*`、`apps/api/src/plugins/auth.plugin.ts`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-09-30

## 負責的程式

`portal` 模組有兩組路由，服務兩群使用者：

| 部分 | 路由檔 | 前綴 | 使用者 | 認證 |
| --- | --- | --- | --- | --- |
| 後台 | `portal.routes.ts` | `/api/v1/portal` | 客服與管理員 | 客服登入，整個 plugin 要求 `portal.view` |
| 粉絲端 | `portal-public.routes.ts` | `/api/v1/fan` | 粉絲 | 粉絲 token（`authenticateFan`） |

服務分成 `portal.service.ts`（活動、提交、抽獎、結果）、`points.service.ts`（積分）與 `portal-auth.service.ts`（粉絲 token）。

租戶後台的前端頁面有活動管理、提交紀錄與積分管理。粉絲端的前端不在這個 repo，`/api/v1/fan` 沒有已知的呼叫端。

## 活動

活動有三種類型：

| 類型 | 粉絲做什麼 | 結果怎麼算 |
| --- | --- | --- |
| `POLL` 投票 | 選一個或多個選項 | 各選項的票數 |
| `FORM` 表單 | 填寫欄位（`PortalField`） | 只記錄內容，不計分 |
| `QUIZ` 問答 | 選答案 | 選中的正確選項數，另算平均分數 |

活動的狀態：

| 狀態 | 意思 | 怎麼進入 |
| --- | --- | --- |
| `DRAFT` | 草稿，只有草稿能編輯 | 建立 |
| `PUBLISHED` | 開放參加 | `POST /activities/:id/publish` |
| `ENDED` | 已結束，不再接受提交 | `POST /activities/:id/end` |
| `ARCHIVED` | 封存，不在清單顯示 | `POST /activities/:id/archive`，可以用 `/unarchive` 還原 |

活動可以設定開始與結束時間。粉絲提交時，系統檢查活動是否已發布、是否已開始、是否已結束。時間到了狀態不會自動變成 `ENDED`，只是提交會被擋下。

## 粉絲怎麼參加

1. 粉絲端呼叫 `POST /api/v1/fan/auth`，帶 `contactId` 與 `tenantId`，取得 24 小時有效的粉絲 token。
2. 以 token 瀏覽活動（`GET /fan/activities`）並提交（`POST /fan/activities/:id/submit`）。
3. 查看結果（`/fan/activities/:id/result`）、自己參加過的活動（`/fan/me/activities`）與積分（`/fan/me/points`）。

粉絲端的每個查詢都以 token 裡的 `tenantId` 與 `contactId` 過濾，因此只看得到自己租戶的活動與自己的紀錄。這組路由使用 `prismaAdmin`，租戶隔離完全靠這個查詢條件。

**取得 token 不需要證明身分。** `/fan/auth` 只檢查這個聯絡人是否存在，不驗證任何 LINE 登入憑證。知道一組聯絡人 ID 與租戶 ID，就能以那個人的身分參加活動、查看他的積分。

**粉絲 token 能通過客服認證。** 粉絲 token 與客服的 JWT 用同一把 `JWT_SECRET` 簽發，而客服端的 `authenticate` 只驗簽章，不檢查 token 是不是客服的。拿粉絲 token 呼叫只驗登入的客服路由，例如對話清單，會被當成該租戶的客服放行；用它連 socket 也會收到全租戶的即時訊息。見 `../../system/AUDIT.md` 的 AUTH-05。

## 提交

`submitActivity()` 的規則：

- 活動設定的 `allowMultiple` 不是 `true` 時，同一個聯絡人只能提交一次。這個檢查在應用層，資料庫沒有唯一限制，同時送出兩次可能都成功。
- 問答的分數是「選中的正確選項數」。選錯不扣分，因此全選的人會拿到滿分。
- 活動設定了 `pointsPerSubmit` 時，每次提交自動加積分。
- 每次提交發布 `portal.activity.submitted`。這個事件有送進自動化的 queue，但不在自動化規則的契約裡，規則編輯器選不到，見[自動化](./AUTOMATION.md#哪些事件能觸發規則)。

正確答案（`PortalOption.isCorrect`）不會回給粉絲端。

## 抽獎

`POST /activities/:id/draw` 從還沒中獎的提交中隨機抽出指定數量，標記為中獎（`isWinner`）。抽的單位是提交，不是聯絡人：允許重複提交的活動，同一個人提交越多次，中獎機率越高，也可能中獎不只一次。

## 積分

積分以交易紀錄（`PointTransaction`）累加，餘額是該聯絡人所有交易的總和。

| 來源 | 程式 |
| --- | --- |
| 提交活動 | `submitActivity()` 依 `pointsPerSubmit` 自動加 |
| 管理員調整 | `POST /portal/points/adjust`，需要 `portal.manage`，可以加也可以扣 |

積分綁在聯絡人上。手動合併聯絡人時，被合併那一方的積分不會搬過去；登入時的自動合併遇到有積分的聯絡人會失敗。見 `../../system/AUDIT.md` 的 CONTACT-01。

## 權限

| 動作 | 權限 |
| --- | --- |
| 讀取活動、提交紀錄、結果、積分 | `portal.view` |
| 建立、修改、刪除、發布、結束、封存活動；抽獎；調整積分 | `portal.manage` |

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **取得粉絲 token 不需要證明身分，且 token 能通過客服認證** | 詳見 `../../system/AUDIT.md` 的 AUTH-05 |
| 重複提交只在應用層檢查 | 同時送出可能重複加分 |
| 問答錯選不扣分 | 全選即可拿滿分 |
| 抽獎以提交為單位 | 允許重複提交時，多提交的人中獎機率較高 |
| 活動結束時間到了不會自動改狀態 | 提交會被擋下，但狀態仍是 `PUBLISHED` |
| 合併聯絡人不處理積分 | 詳見 `../../system/AUDIT.md` 的 CONTACT-01 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
