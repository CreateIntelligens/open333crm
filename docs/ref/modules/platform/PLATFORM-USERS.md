# 平台帳號管理

建立、修改與停用營運方自己的帳號。管的是 `platform_users`，不是租戶的成員。

- **資料來源**：`apps/api/src/modules/platform/platform-user.service.ts`、`platform-user-emails.ts`
- **核對日期**：2026-09-23

## 沒有角色分級

所有平台帳號的權限相同。JWT 只帶一種 `role`，值固定是 `PLATFORM_SUPERUSER`，平台側也沒有相當於租戶 RBAC 的權限表。能登入平台後台，就能做這個模組的每一件事，包含建立與停用其他平台帳號。

## 建立帳號時不輸入密碼

建立帳號只需要 email 與姓名。密碼由系統產生：

1. email 正規化後檢查全域唯一，重複回 409 `CONFLICT`。
2. `generateTempPassword()` 產生臨時密碼，雜湊後寫入，`mustChangePassword` 設成 `true`。
3. 寄開通信，信裡有明文臨時密碼與登入網址。

**臨時密碼只出現在那一封信裡。** 資料庫只有雜湊，介面沒有任何地方能再看一次。而且建立帳號時的寄信是 fire-and-forget：`sendEmail` 失敗只寫 log，不影響建立結果，操作者仍然看到成功。信沒寄到的唯一補救是重寄開通信。

## 重寄開通信會換掉密碼

`POST /platform-users/:id/resend-welcome` 不是把同一封信再寄一次，它會重新產生臨時密碼、覆寫雜湊、把 `mustChangePassword` 設回真。**舊的臨時密碼立刻失效。** 對方若已經拿到前一封信但還沒登入，那封信就不能用了。

已停用的帳號不能重寄，回 400 `PLATFORM_USER_DISABLED`。理由是換了密碼、寄了信，對方登入仍然會被 `isActive` 擋下，與其讓操作者誤以為補救完成，不如先擋。要重寄就先啟用帳號。

## 停用帳號的兩道防呆

| 防呆 | 錯誤碼 | 理由 |
| --- | --- | --- |
| 不能停用自己 | 400 `CANNOT_DISABLE_SELF` | `callerId` 來自已驗證的 token，交易外先擋即可 |
| 不能讓啟用中的帳號歸零 | 400 `PLATFORM_LAST_USER_ACTIVE` | 帳號歸零就沒有人能登入平台後台，無法自救 |

第二道防呆的讀取、計數與更新包在同一個 `Serializable` 交易內。兩位管理者同時停用最後兩個帳號時，資料庫只讓一邊成功。

另一邊拿到的是序列化衝突，沒有重試，回 400 `DATABASE_ERROR`。帳號不會歸零，但操作者要自己再按一次。

停用立即生效，連對方手上還沒過期的 token 也一起失效，見[平台帳號認證](./AUTH.md#停用帳號多久生效)。

## 查一個帳號做過什麼

`GET /platform-users/:id/audit-logs` 回傳的不只是這個帳號做的事，而是兩種紀錄的聯集：

- `platformUserId` 等於這個帳號，也就是他自己執行的操作。
- `targetType` 是 `platform_user` 且 `targetId` 等於這個帳號，也就是別人對他做的操作。

依時間新到舊排序，最多 200 筆，沒有分頁也沒有日期篩選。

## 修改帳號

`PATCH /platform-users/:id` 只能改姓名與 email，而且至少要給一個欄位。email 換成別人已在用的值回 409 `CONFLICT`。改 email 不會通知對方，也不會影響他手上的 token，因為 token 認的是帳號 id。

介面看不到密碼雜湊與重設 token，列表與明細都只回傳 `PUBLIC_SELECT` 的欄位。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
