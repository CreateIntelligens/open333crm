/**
 * 佇列監控的來源 IP 檢查（change queue-monitoring，design 決策 2）。
 *
 * request.ip 依 trustProxy（lib/trust-proxy.ts）計算：只信任私有網段的代理，
 * 所以請求自帶的 X-Forwarded-For 不會改變網段外連線的來源 IP。
 */
import { BlockList, isIP } from 'node:net';
import { logger } from '@open333crm/core';

/**
 * 解析以逗號分隔的網段清單。沒有設定、空值，或任一個網段格式錯誤時，回傳空清單：
 * 格式錯誤時記一行 error log，所有連線都會被拒絕，API 照常啟動。
 */
export function parseAllowedCidrs(raw: string | undefined): BlockList {
  const list = new BlockList();
  const entries = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const parsed: Array<{ address: string; prefix: number; family: 'ipv4' | 'ipv6' }> = [];
  for (const entry of entries) {
    const [address, prefixText] = entry.split('/');
    const version = isIP(address ?? '');
    const prefix = Number(prefixText);
    const maxPrefix = version === 4 ? 32 : 128;
    if (!version || prefixText === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      logger.error(`[queue-monitoring] QUEUE_DASHBOARD_ALLOWED_CIDRS 的網段格式錯誤：${entry}。所有來源都會被拒絕`);
      return new BlockList();
    }
    parsed.push({ address: address!, prefix, family: version === 4 ? 'ipv4' : 'ipv6' });
  }
  for (const { address, prefix, family } of parsed) list.addSubnet(address, prefix, family);
  return list;
}

/** IPv4 對應的 IPv6 位址（::ffff:a.b.c.d）以其 IPv4 位址比對 */
export function isAllowedIp(list: BlockList, ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const address = mapped ?? ip;
  const version = isIP(address);
  if (!version) return false;
  return list.check(address, version === 4 ? 'ipv4' : 'ipv6');
}
