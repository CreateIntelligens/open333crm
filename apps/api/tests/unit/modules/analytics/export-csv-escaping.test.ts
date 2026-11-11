/**
 * 報表匯出 CSV 的欄位跳脫（#423、ANA-03，change fix-csv-export-escaping，
 * 規格 analytics-reports「匯出的 CSV 欄位經過跳脫與公式防護」）。
 * 聯絡人名稱、客服姓名、工單標題與分類都可能含逗號或以 = 開頭。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { exportCsv } from '#src/modules/analytics/analytics.service.js';
import { createMockTenantCtx } from '../../../support/mock-tenant-ctx.js';
import { parseCsv } from '../../../support/parse-csv.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

const FROM = new Date('2026-10-01');
const TO = new Date('2026-10-15');
const EVIL = '=HYPERLINK("http://evil.example","hc-analytics, 點我")';

async function exportRows(reportType: string, tx: unknown) {
  const { ctx } = createMockTenantCtx(tx);
  const csv = await exportCsv(ctx, ALL_CHANNELS, reportType, FROM, TO);
  return parseCsv(csv.slice(1));
}

/** 兩張工單：第一張的標題、分類、客服姓名、聯絡人名稱都需要跳脫，第二張標題含換行 */
function exportCases() {
  return exportRows('cases', {
    case: {
      findMany: async () => [
        {
          id: 'case-1',
          title: '=1+1 退貨, 急件',
          status: 'OPEN',
          priority: 'HIGH',
          category: '+分類',
          assignee: { name: '客服 "阿明"' },
          contact: { displayName: EVIL },
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
          resolvedAt: null,
          csatScore: 5,
        },
        {
          id: 'case-2',
          title: '第一行\n第二行',
          status: 'RESOLVED',
          priority: 'LOW',
          category: null,
          assignee: null,
          contact: { displayName: '-王, 小美' },
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
          resolvedAt: new Date('2026-10-04T00:00:00.000Z'),
          csatScore: null,
        },
      ],
    },
  });
}

test('聯絡人名稱含逗號與公式時工單 CSV 欄數正確', async () => {
  const rows = await exportCases();
  assert.equal(rows.length, 3);
  for (const r of rows) assert.equal(r.length, 10);
  assert.equal(rows[1][6], `'${EVIL}`);
  assert.equal(rows[2][6], "'-王, 小美");
  assert.equal(rows[1][9], '5');
});

test('標題、分類、客服姓名以公式字元開頭或含換行時加以跳脫', async () => {
  const rows = await exportCases();
  for (const r of rows) assert.equal(r.length, 10);
  assert.equal(rows[1][1], "'=1+1 退貨, 急件");
  assert.equal(rows[1][4], "'+分類");
  assert.equal(rows[1][5], '客服 "阿明"');
  assert.equal(rows[2][1], '第一行\n第二行');
});

test('客服 CSV 的數字欄位不加單引號', async () => {
  const rows = await exportRows('agents', {
    $queryRaw: async () => [
      {
        agent_id: 'agent-1',
        agent_name: '@陳, 大文',
        agent_role: 'AGENT',
        cases_handled: 3n,
        cases_resolved: 2n,
        avg_first_response: -1.5,
        avg_resolution: 30,
        csat_avg: 4.5,
        sla_total: 2n,
        sla_achieved: 1n,
      },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 9);
  assert.equal(rows[1].length, 9);
  assert.equal(rows[1][1], "'@陳, 大文");
  assert.deepEqual(rows[1].slice(3), ['3', '2', '-1.5', '30', '4.5', '50']);
});

test('渠道 CSV 的渠道名稱經過跳脫', async () => {
  const results = [
    [{ channel_type: 'LINE,X', count: 3n }],
    [{ channel_type: 'LINE,X', count: 2n }],
    [],
    [],
  ];
  const rows = await exportRows('channels', { $queryRaw: async () => results.shift() ?? [] });
  assert.equal(rows[1].length, 3);
  assert.deepEqual(rows[1], ['LINE,X', '3', '2']);
});

test('概覽 CSV 的負數不加單引號', async () => {
  const rows = await exportRows('overview', {
    $queryRaw: async () => [
      { total: 5n, inbound: 3n, outbound: 2n, achieved: 1n, avg_first_response: -2, avg_resolution: null, avg_score: null, positive: 0n },
    ],
    case: { count: async () => 1 },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, rows[1].length);
  const byKey = Object.fromEntries(rows[0].map((k, i) => [k, rows[1][i]]));
  assert.equal(byKey.totalMessages, '5');
  assert.equal(byKey.avgFirstResponseMinutes, '-2');
  assert.equal(byKey.avgResolutionMinutes, '');
});
