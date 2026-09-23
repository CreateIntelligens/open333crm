# 平台帳號管理

建立、停用與修改營運方帳號。

- **資料來源**：`apps/api/src/modules/platform/platform-user.service.ts`、`platform-user-emails.ts`
- **核對日期**：2026-09-23

建立、停用、修改營運方帳號，以及重寄開通信。`GET /platform-users/:id/audit-logs` 查該帳號的操作紀錄。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
