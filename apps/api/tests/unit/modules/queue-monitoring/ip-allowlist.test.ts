/**
 * 佇列監控的來源 IP 檢查（change queue-monitoring：queue-monitoring「只允許設定的網段連線」
 * 「沒有設定網段時拒絕所有連線」）。
 *
 * 以 fastify.inject() 的 remoteAddress 模擬連線來源；trustProxy 與正式環境相同，只信任私有網段的代理。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import {
  buildQueueMonitoringApp,
  OFFICE_IP,
  OUTSIDE_IP,
  QUEUES_PATH,
  type QueueMonitoringApp,
} from '../../../support/queue-monitoring-app.js';

const OFFICE_CIDR = '60.248.142.0/24';

let office: QueueMonitoringApp;
let unset: QueueMonitoringApp;
let cookie: string;

beforeAll(async () => {
  office = await buildQueueMonitoringApp({ allowedCidrs: OFFICE_CIDR });
  unset = await buildQueueMonitoringApp({ allowedCidrs: undefined, withPlatformRoutes: true });
  cookie = await office.sessionCookie(OFFICE_IP).catch(() => '');
});
afterAll(async () => {
  await office.app.close();
  await unset.app.close();
});

test('網段內的 IP 連線', async () => {
  const res = await office.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie });

  assert.equal(res.statusCode, 200, res.body);
});

test('網段外的 IP 連線', async () => {
  const res = await office.inject({ method: 'GET', url: QUEUES_PATH, ip: OUTSIDE_IP, cookie });

  assert.equal(res.statusCode, 403);
});

test('網段外的 IP 偽造 X-Forwarded-For', async () => {
  const res = await office.inject({
    method: 'GET',
    url: QUEUES_PATH,
    ip: OUTSIDE_IP,
    cookie,
    headers: { 'x-forwarded-for': OFFICE_IP },
  });

  assert.equal(res.statusCode, 403);
});

test('經受信任代理轉來的網段內 IP：以代理附加的 X-Forwarded-For 比對', async () => {
  const res = await office.inject({
    method: 'GET',
    url: QUEUES_PATH,
    ip: '172.18.0.1',
    cookie,
    headers: { 'x-forwarded-for': OFFICE_IP },
  });

  assert.equal(res.statusCode, 200, res.body);
});

test('IPv4 對應的 IPv6 位址', async () => {
  const res = await office.inject({ method: 'GET', url: QUEUES_PATH, ip: `::ffff:${OFFICE_IP}`, cookie });

  assert.equal(res.statusCode, 200, res.body);
});

test('換發 cookie 的端點也檢查網段', async () => {
  const res = await office.inject({
    method: 'POST',
    url: `${QUEUES_PATH}/session`,
    ip: OUTSIDE_IP,
    headers: { authorization: `Bearer ${office.platformToken()}` },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('網段外的 IP 不檢查登入：沒有 cookie 也回 403', async () => {
  const res = await office.inject({ method: 'GET', url: `${QUEUES_PATH}/api/queues`, ip: OUTSIDE_IP });

  assert.equal(res.statusCode, 403);
});

test('沒有設定網段', async () => {
  const res = await unset.inject({ method: 'GET', url: QUEUES_PATH, ip: '127.0.0.1', cookie });

  assert.equal(res.statusCode, 403);
});

test('網段格式錯誤時整份清單視為空清單', async () => {
  const invalid = await buildQueueMonitoringApp({ allowedCidrs: `${OFFICE_CIDR},not-a-cidr` });
  try {
    const res = await invalid.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie });
    assert.equal(res.statusCode, 403);
  } finally {
    await invalid.app.close();
  }
});

test('平台後台的其他路由不受影響', async () => {
  const res = await unset.inject({
    method: 'GET',
    url: '/api/v1/platform/plans',
    ip: '127.0.0.1',
    headers: { authorization: `Bearer ${unset.platformToken()}` },
  });

  assert.equal(res.statusCode, 200, res.body);
});
