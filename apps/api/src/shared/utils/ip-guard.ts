/**
 * 後端對外連線（會員綁定端點、webhook 轉送）不能連到的位址：私有、loopback、link-local（含雲端 metadata）、
 * CGNAT、保留與 multicast 網段。
 *
 * IPv6 一律先展開成 8 組 16 位元再判斷：`new URL()` 會把 `[::ffff:127.0.0.1]` 正規化成 `[::ffff:7f00:1]`，
 * 只比對字串的話會被這類寫法繞過（code review 2026-10-21）。內嵌 IPv4 的寫法（IPv4-mapped、
 * IPv4-compatible、NAT64 64:ff9b::/96）取出 IPv4 再判斷。
 */
import { isIP } from 'node:net';

function ipv4Octets(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.some((p) => p > 255) ? null : parts;
}

function isBlockedIpv4(o: number[]): boolean {
  const [a, b, c] = o;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local／雲端 metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast（224/4）與保留（240/4）
  );
}

/** 展開成 8 組 16 位元整數；格式不對回 null */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  // 結尾是點分 IPv4（::ffff:1.2.3.4）：換成兩組 16 位元
  const tail = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const o = ipv4Octets(tail[1]);
    if (!o) return null;
    s = `${s.slice(0, -tail[1].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((h) => parseInt(h, 16)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<number>(fill).fill(0), ...rest];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function embeddedIpv4(g: number[]): number[] {
  return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
}

function isBlockedIpv6(g: number[]): boolean {
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return true; // ::
  if (zeros(7) && g[7] === 1) return true; // ::1
  if (zeros(5) && g[5] === 0xffff) return isBlockedIpv4(embeddedIpv4(g)); // IPv4-mapped
  if (zeros(6)) return isBlockedIpv4(embeddedIpv4(g)); // IPv4-compatible（已廢止，仍可能被解析）
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIpv4(embeddedIpv4(g)); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** 位址是否不可連線；不是合法 IP 的字串一律視為封鎖 */
export function isBlockedIp(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(ip);
  if (family === 4) {
    const o = ipv4Octets(ip);
    return o ? isBlockedIpv4(o) : true;
  }
  if (family === 6) {
    const g = ipv6Groups(ip.replace(/%.*$/, ''));
    return g ? isBlockedIpv6(g) : true;
  }
  return true;
}
