## Why

UAT E2E 欄位測試（Wave 6）以 `test.fail` 記錄的已知 bug，2026-10-12 重跑後仍有 5 個沒修：

| 測試 | 問題 |
| --- | --- |
| BUG-W6-06 | 升級工單的 `notifyTargets` 接受任意字串；而且通知 worker 根本不讀它，一律通知主管與管理員，升級視窗的「通知原指派人」勾選沒有作用 |
| BUG-W6-08 | 聯絡人電話是 `z.string()`，沒有字元與長度限制，`<script>`、上萬字都能存 |
| botConfig.liffId（P2） | 渠道設定的 LIFF ID 不驗證格式。測試送錯欄位：實際欄位是 `settings.liffConfig.liffId`（短連結的 LIFF 轉址讀這個欄位） |
| 起訖日顛倒（P2） | 分析 API 的 `from` 晚於 `to` 時不擋，回傳全 0 報表，使用者以為沒有資料 |
| 純空白目標 URL（P3） | 短連結表單只檢查非空，純空白會讓「儲存」可按（後端已擋，使用者收到錯誤） |

2026-10-12 使用者決定：電話用寬鬆規則（只限字元與長度，國際號碼也能存）；通知對象限制為固定值，並讓勾選真的生效。

## What Changes

- 升級工單：`notifyTargets` 只接受 `supervisor`、`original_assignee`；通知依勾選送給主管與管理員、升級前的指派人。沒有帶 `notifyTargets` 的呼叫維持只通知主管與管理員。
- 聯絡人電話：去頭尾空白後 0–30 字，只能有數字、空白、`+`、`-`、`(`、`)`、`#`；空字串視為清除。
- 渠道設定：`settings.liffConfig.liffId` 要符合 LIFF ID 格式（10 位數字、`-`、8 個英數字），空字串視為清除。
- 分析 API：`from` 晚於 `to` 回 400，指出 `from` 欄位。
- 短連結表單：目標網址去空白後為空時，「儲存」不可按。

## Capabilities

### New Capabilities

- `analytics-reports`：分析報表 API 的日期區間規則。

### Modified Capabilities

- `case-management`：新增升級通知對象的需求。
- `contact-management`：新增電話格式的需求。
- `shortlink-ua-strategy`：新增 LIFF ID 儲存時驗證的需求。
- `shortlink-routing`：新增短連結表單擋空白目標網址的需求。

## Impact

- API：`case.routes.ts`、`case.service.ts`（事件帶通知對象與升級前指派人）、`notification.worker.ts`、`contact.routes.ts`、`channel.routes.ts`、`analytics.routes.ts`
- Web：`components/shortlink/LinkFormDialog.tsx`
- UAT E2E：上述 5 個 `test.fail` 改為一般測試；LIFF ID 測試改用 `liffConfig.liffId`
- 文件：`CHANGELOG.md`；功能文件中描述這些欄位的段落
