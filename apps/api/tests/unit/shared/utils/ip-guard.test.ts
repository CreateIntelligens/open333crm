/**
 * 後端對外連線的 IP 封鎖（code review 2026-10-21）：IPv6 的各種寫法都要還原成實際位址再判斷，
 * 否則 [::ffff:7f00:1] 這類寫法會繞過私有網段檢查。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isBlockedIp } from '#src/shared/utils/ip-guard.js';

test('IPv4 私有、保留與特殊網段', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '240.0.0.1', '192.0.0.8']) {
    assert.ok(isBlockedIp(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.10']) assert.ok(!isBlockedIp(ip), ip);
});

test('IPv4-mapped 與相容 IPv6 的各種寫法', () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '[::ffff:7f00:1]', '::ffff:a9fe:a9fe', '::7f00:1', '0:0:0:0:0:ffff:7f00:0001', '::ffff:0a00:0001']) {
    assert.ok(isBlockedIp(ip), ip);
  }
  assert.ok(!isBlockedIp('::ffff:808:808'), '::ffff:8.8.8.8 是公開位址');
});

test('NAT64 內嵌私有位址', () => {
  assert.ok(isBlockedIp('64:ff9b::7f00:1'));
  assert.ok(isBlockedIp('64:ff9b::a9fe:a9fe'));
});

test('IPv6 loopback、unique local、link-local、multicast', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '0:0:0:0:0:0:0:1']) {
    assert.ok(isBlockedIp(ip), ip);
  }
  assert.ok(!isBlockedIp('2001:4860:4860::8888'));
});

test('不是 IP 的字串視為封鎖', () => {
  assert.ok(isBlockedIp('localhost'));
  assert.ok(isBlockedIp(''));
});
