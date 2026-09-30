/**
 * 測試用記憶體版綁定代碼儲存（取代 Redis）：支援 PX 過期、NX、GETDEL、INCR（保留 TTL）、PTTL、PEXPIRE，
 * 時間由 clock 控制，可快轉測試過期與頻率限制。
 */
import type { BindingStore } from '../../modules/identity-binding/binding-code.js';

export function memBindingStore(clock: { now: number } = { now: Date.now() }): BindingStore {
  const m = new Map<string, { v: string; exp: number | null }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= clock.now) {
      m.delete(k);
      return null;
    }
    return e;
  };
  return {
    async set(k, v, _mode, ttl) {
      if (live(k)) return null;
      m.set(k, { v, exp: clock.now + ttl });
      return 'OK';
    },
    async getdel(k) {
      const e = live(k);
      if (!e) return null;
      m.delete(k);
      return e.v;
    },
    async get(k) {
      return live(k)?.v ?? null;
    },
    async pttl(k) {
      const e = live(k);
      if (!e) return -2;
      return e.exp === null ? -1 : e.exp - clock.now;
    },
    async pexpire(k, ms) {
      const e = live(k);
      if (!e) return 0;
      e.exp = clock.now + ms;
      return 1;
    },
    async incr(k) {
      const e = live(k);
      const n = Number(e?.v ?? 0) + 1;
      m.set(k, { v: String(n), exp: e?.exp ?? null });
      return n;
    },
  };
}
