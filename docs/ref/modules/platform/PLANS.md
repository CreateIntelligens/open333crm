# 方案與上限

方案定義租戶的功能範圍與數量上限。這一份說明每個欄位控制什麼，以及有效上限怎麼算出來。

- **資料來源**：`apps/api/src/modules/platform/plan.service.ts`、`plan-limits.service.ts`、`platform.routes.ts`
- **核對日期**：2026-09-23

這一份會反覆出現「天花板」。它指方案允許的權限上限，定義與公式見[平台後台](./README.md#用語天花板)。

## 四個欄位各控制什麼

`Plan` 的四個欄位互不取代，改其中一個不影響其他三個。

| 欄位 | 中文名 | 作用 | 空值的意義 |
| --- | --- | --- | --- |
| `features` | 功能模組清單 | 方案包含哪些功能模組。功能天花板由這份清單換算而來，`core` 恆開 | 空陣列代表只有 `core` |
| `limits` | 數值上限 | `maxAgents`、`maxChannels`、`maxTags`、`monthlyTokens` 的數量上限 | 某個 key 的值為 `null` 代表該項無上限 |
| `allowedChannelTypes` | 可建立的渠道類型白名單 | 限制這個方案能建立哪些渠道類型。`channel.service.ts` 在建立渠道時檢查，不符合回 403 `CHANNEL_TYPE_NOT_ALLOWED` | **空陣列代表不限制**，不是全部禁止 |
| `permissionOverrides` | 權限碼扣除清單 | 從 `features` 算出的天花板再扣掉指定的權限碼，結構是 `{ deny: string[] }` | 空物件代表不扣除任何權限 |

兩個欄位的名稱容易誤讀：

- `allowedChannelTypes` 是白名單，但**空陣列是「不限制」而不是「全部禁止」**。判斷式是「白名單非空、且這個類型不在裡面才擋」。另外它只擋新建的渠道，既有渠道不受影響。
- `permissionOverrides` 雖然叫 override，實際上**只能扣除，不能加回**。`permission.service.ts` 先以 `features` 算出天花板，再逐一刪掉 `deny` 裡的權限碼。要放寬權限只能改 `features`。扣除不會連坐：deny 一個高階權限碼，不會一併扣掉相關的低階碼。

`slug` 全域唯一，程式用它認方案（`trial.planSlug`、升級申請的 `targetPlanSlug`、平台改方案的 `planSlug` 都是傳 slug）。`priceMonthly` 只是顯示用，這個系統不接金流。

## 路由層先擋掉哪些值

`updatePlanSchema` 在寫入前就驗過一輪，因此服務層不必再檢查：

| 欄位 | 規則 |
| --- | --- |
| `limits` | 每個值是非負整數或 `null`。擋掉小數、負數與字串 |
| `allowedChannelTypes` | 每個值必須是 Prisma `ChannelType` 的合法值 |
| `permissionOverrides.deny` | 每個值必須在 `PERMISSION_CODES` 內，否則回「未知的權限碼」 |
| `features` | 只驗型別是字串陣列，**不驗 slug 是否存在** |

`features` 是唯一沒被驗值的欄位。寫進一個不存在的 feature slug 不會報錯，`permsForFeatures()` 找不到對應權限，那個 slug 等同沒寫。

## 停售不會生效

`Plan.isActive` 的註解寫的是「停售軟下架」，但**整個 repo 沒有任何查詢讀這個欄位**。把方案設為停售之後，它仍然可以被指派：平台改租戶方案、核准升級申請、試用開通綁定方案，三條路徑都只用 slug 找方案，沒有一條檢查 `isActive`。詳見 `../../system/AUDIT.md` 的 PLAN-01。

## 有效上限怎麼算

`plan-limits.service.ts` 解析單一租戶的有效上限。**這支服務不屬於平台後台**，沒有任何平台路由呼叫它，呼叫者都在租戶側：`agent.service.ts`、`channel.service.ts` 與 `trial/token-quota.service.ts`。

判斷順序是「租戶的覆寫優先」，但判斷的是 key 存不存在，不是值是不是空：

```text
limitOverrides 有這個 key（即使值是 null）→ 用 limitOverrides 的值
否則                                      → 用 Plan.limits 的值
```

差別在 `null`。`Tenant.limitOverrides` 寫 `{ "maxAgents": null }` 的意思是「這個租戶的人數改成無上限」，而不是「沒設定，回去看方案」。程式用 `hasOwnProperty` 判斷，不是 `??`。

回傳 `null` 一律代表無上限，三種情況都會得到 `null`：

- 覆寫或方案裡該 key 的值本身是 `null`。
- 租戶沒有綁定方案。
- 方案沒有定義這個 key。

AI 月額度的加購是直接改寫 `limitOverrides.monthlyTokens`，見[方案異動審核](./PLAN-CHANGES.md#加購是永久提高每月額度)。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
