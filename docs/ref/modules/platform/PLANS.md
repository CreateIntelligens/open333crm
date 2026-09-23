# 方案與上限

方案定義租戶的功能範圍與數量上限。這一份說明四個欄位各自控制什麼。

- **資料來源**：`apps/api/src/modules/platform/plan.service.ts`、`plan-limits.service.ts`
- **核對日期**：2026-09-23

這一份會反覆出現「天花板」。它指方案允許的權限上限，定義與公式見[平台後台](./README.md#用語天花板)。

`Plan` 的四個欄位分別控制不同的東西。四者互不取代，改其中一個不影響其他三個。

| 欄位 | 中文名 | 作用 | 空值的意義 |
| --- | --- | --- | --- |
| `features` | 功能模組清單 | 方案包含哪些功能模組。功能天花板由這份清單換算而來，`core` 恆開 | 空陣列代表只有 `core` |
| `limits` | 數值上限 | `maxAgents`、`maxChannels`、`maxTags`、`monthlyTokens` 等數量上限 | 某個 key 的值為 `null` 代表該項無上限 |
| `allowedChannelTypes` | 可建立的渠道類型白名單 | 限制這個方案能建立哪些渠道類型。`channel.service.ts` 在建立渠道時檢查，不符合就回 403 `CHANNEL_TYPE_NOT_ALLOWED` | **空陣列代表不限制**，不是全部禁止 |
| `permissionOverrides` | 權限碼扣除清單 | 從 `features` 算出的天花板再扣掉指定的權限碼，結構是 `{ deny: string[] }` | 空物件代表不扣除任何權限 |

兩個欄位的名稱容易誤讀：

- `allowedChannelTypes` 是白名單，但**空陣列是「不限制」而不是「全部禁止」**。判斷式是「白名單非空且此類型不在內才擋」。另外它只擋新建的渠道，既有渠道不受影響。
- `permissionOverrides` 雖然叫 override，實際上**只支援扣除，不能加回**。`permission.service.ts` 先以 `features` 算出天花板，再逐一刪掉 `deny` 裡的權限碼。要放寬權限只能改 `features`。扣除不會連坐：deny 一個高階權限碼不會一併扣掉相關的低階碼。

**`plan-limits.service.ts` 不屬於平台後台。** 沒有任何平台路由呼叫這支服務。它的工作是解析單一租戶的有效上限，呼叫者都在租戶側：`agent.service.ts`、`channel.service.ts` 與 `trial/token-quota.service.ts`。計算方式是：

```text
有效上限 = Tenant.limitOverrides[key] ?? Plan.limits[key]
```

回傳 `null` 代表無上限。三種情況都會得到 `null`：

- `limitOverrides` 或 `limits` 裡該 key 的值本身是 null。
- 租戶沒有綁定方案。
- 方案沒有定義這個 key。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
