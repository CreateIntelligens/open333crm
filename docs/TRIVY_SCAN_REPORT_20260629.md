# Trivy / SBOM 掃描摘要

掃描日期：2026-06-29

本次已產出以下檔案：

- `sbom.syft.cdx.json`：由 Syft 產生的 CycloneDX SBOM
- `sbom.trivy.cdx.json`：由 Trivy 產生的 CycloneDX SBOM
- `trivy-fs.json`：由 Trivy 產生的 filesystem 安全掃描結果

## 說明

`Syft` 與 `Trivy` 都能產生 SBOM，但兩者的元件辨識邏輯、支援生態系與欄位內容不同，因此結果不會完全一致。

`trivy-fs.json` 不是 SBOM，而是安全掃描結果，包含漏洞與其他風險資訊，適合交由工程團隊後續排程修補。

## 掃描摘要

- `CRITICAL`：4
- `HIGH` / `CRITICAL`：42 筆
- 去重後 `HIGH` / `CRITICAL`：42 筆

漏洞來源分佈：

- `pnpm-lock.yaml`：72

## 高風險重點

### Critical

- `fast-jwt` `5.0.6`
  - `CVE-2026-34950`
  - `CVE-2026-35039`
  - `CVE-2026-44351`
  - 建議升級至 `6.2.4` 或以上安全版本
- `jsonpath-plus` `7.2.0`
  - `CVE-2024-21534`
  - 建議升級至 `10.2.0` 或以上安全版本

### 主要 High 風險

- `axios` `1.13.6`
  - 共 10 筆 `HIGH`
  - 涵蓋 Header Injection、Proxy Bypass、資訊洩漏、MITM、DoS 等風險
  - 建議升級至 `1.16.0` 或以上安全版本
- `next` `15.5.13`
  - 共 8 筆 `HIGH`
  - 涵蓋授權繞過、資訊洩漏、SSRF、DoS 等風險
  - 建議升級至 `15.5.18` 或以上安全版本
- `@xmldom/xmldom` `0.8.11`
  - 共 5 筆 `HIGH`
  - 涵蓋 XML 結構注入、任意節點注入、DoS 等風險
  - 建議升級至 `0.8.13` 或以上安全版本
- `jsonpath-plus` `7.2.0`
  - 除 `CRITICAL` 外另有 `HIGH`
  - 建議直接升級到 `10.3.0`
- `fastify` `5.8.2`
  - `CVE-2026-33806`
  - 建議升級至 `5.8.5`
- `lodash` `4.17.23`
  - `CVE-2026-4800`
  - 建議升級至 `4.18.0`
- `socket.io-parser` `4.2.5`
  - `CVE-2026-33151`
  - 建議升級至 `4.2.6`
- `ws` `8.18.3`
  - `CVE-2026-48779`
  - 建議升級至 `8.21.0`
- `xlsx` `0.18.5`
  - 2 筆 `HIGH`
  - 建議升級至 `0.20.2`

## 建議處理順序

1. 先處理 `CRITICAL`：`fast-jwt`、`jsonpath-plus`
2. 再處理 `next`、`axios`，這兩組影響面最大
3. 接著處理通用基礎套件：`@xmldom/xmldom`、`lodash`、`ws`、`socket.io-parser`
4. 最後整理其餘相依：`fastify`、`xlsx`、`form-data`、`fast-uri`、`defu`、`effect`

## 交付檔案

- `docs/TRIVY_SCAN_REPORT_20260629.md`
- `sbom.syft.cdx.json`
- `sbom.trivy.cdx.json`
- `trivy-fs.json`
