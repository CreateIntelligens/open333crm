## Context

`ChannelType` 原本是 `packages/shared` 中手動維護的 union type（`'LINE' | 'FB' | 'WEBCHAT' | 'WHATSAPP'`），且缺少 `TELEGRAM` 和 `THREADS`。所有 runtime 比較都是字串字面量，TypeScript 無法防止 typo。

## Goals / Non-Goals

**Goals:**
- 單一 source of truth：`CHANNEL_TYPE` const object
- Compile-time typo 保護（`CHANNEL_TYPE.LIEN` → TS error）
- 修正前端 `'FACEBOOK'` → `'FB'` 的歷史 bug

**Non-Goals:**
- 強制 Prisma generated enum 與 shared 同步（Prisma schema 仍是 DB source of truth）
- 更改 display label maps（`{ LINE: 'LINE', FB: 'Facebook' }` 維持字串 key）

## Decisions

**`as const` object 而非 TypeScript enum**：`as const` 產生的是純字串值，與 Prisma string 欄位完全相容，不需要 cast。TypeScript native enum 會編譯成 IIFE，難以與 Prisma 的 string enum 互操作。

**`ChannelType` 型別衍生自 const**：`typeof CHANNEL_TYPE[keyof typeof CHANNEL_TYPE]` 自動與 const object 同步，不需要重複維護。

**`allowedChannelTypes: readonly string[]` 維持**：Prisma 的 `$Enums.ChannelType` 包含所有 Prisma 渠道（含未來值），強制用 shared `ChannelType` 會造成型別衝突。

## Risks / Trade-offs

- [Risk] `packages/shared` 中的 `CHANNEL_TYPE` 未涵蓋所有 Prisma enum 值 → 新增渠道時需同步更新 shared const + Prisma schema 兩處
