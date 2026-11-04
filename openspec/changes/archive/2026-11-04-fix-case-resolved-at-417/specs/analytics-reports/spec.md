## ADDED Requirements

### Requirement: 已解決數以工單的解決時間判斷

總覽的已解決數 SHALL 只計算 `resolvedAt` 在查詢區間內的工單。因為狀態轉換依 `case-management` 的規則維護 `resolvedAt`，直接關閉的工單與解決後重開的工單 SHALL NOT 算入已解決數；從已解決轉成已關閉的工單 SHALL 算入。

#### Scenario: 直接關閉與重開的工單不算已解決

- **WHEN** 區間內同一個渠道有五張工單：直接關閉、解決、解決後改回處理中、解決後關閉、解決後關閉再重開，成員查詢只含這個渠道的總覽
- **THEN** 總覽的 `resolvedCases` 為 2
