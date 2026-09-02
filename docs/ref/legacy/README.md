# legacy — 外部 LINE CRM 系統的參考文件

**這個目錄的文件描述的不是本 repo 的程式碼。**

這四份文件描述另一套獨立的 LINE CRM 系統，技術堆疊是 **Laravel 11 + Vue 3 + MongoDB**。它們在 commit `1786689`（實作 LINE Official Account 渠道外掛）時加入，用途是對照該系統處理 LINE API 的做法。

本 repo 是 TypeScript 單一儲存庫：Fastify 5 + Next.js 15 + Prisma + PostgreSQL。兩者沒有共用任何程式碼。

## 判斷依據

| 文件                       | 描述的系統           | 可驗證的線索                                                      |
| -------------------------- | -------------------- | ----------------------------------------------------------------- |
| `ARCHITECTURE.md`          | Laravel 11 + MongoDB | 內文列出 `linecorp/line-bot-sdk` 的 PHP facade 與 Laravel Horizon |
| `FRONTEND-ARCHITECTURE.md` | Vue 3 + Vite SPA     | 內文列出 `vue`、`vue-router`、`axios` 的版本                      |
| `API-ENDPOINTS.md`         | Laravel              | 端點對應到 `app/Http/Controllers/*.php`                           |
| `LINE-OA-API-INVENTORY.md` | Laravel              | 檔案位置欄位指向 `app/Services/Line/*.php`                        |

## 讀這些文件時的注意事項

1. **不要把這裡的端點、資料表或類別名稱當作本 repo 的現況。** 兩套系統的 API 路徑、資料模型與目錄結構都不同。
2. **本 repo 的現況文件在上一層** `docs/ref/`，見該目錄的 `README.md`。
3. 這些文件沒有維護計畫。它們記錄的是加入當下的外部系統狀態，之後不會隨本 repo 更新。
