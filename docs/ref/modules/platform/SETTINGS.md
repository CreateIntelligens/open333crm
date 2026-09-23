# 平台設定與權限註冊表

平台層的 KV 設定，以及提供給後台介面的功能與渠道類型清單。

- **資料來源**：`apps/api/src/modules/platform/platform-setting.service.ts`、`apps/api/src/modules/platform/platform.routes.ts`
- **核對日期**：2026-09-23

`PlatformSetting` 是以 `key` 為主鍵的 JSON 設定表。`GET /registry` 不讀資料庫，它回傳 `buildPlatformRegistry()` 的功能清單，以及從 Prisma 的 `ChannelType` enum 動態取得的渠道類型，因此新增渠道類型不需要改這段程式。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
