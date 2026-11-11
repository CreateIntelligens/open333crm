/**
 * 測試用記憶體版綁定代碼儲存（取代 Redis）：支援 PX 過期、NX／XX、GETDEL、INCR（保留 TTL）、PTTL、PEXPIRE，
 * 時間由 clock 控制，可快轉測試過期與頻率限制。
 */
import type { BindingStore } from '#src/modules/identity-binding/binding-code.js';

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
    async set(k, v, _mode, ttl, condition) {
      const exists = live(k) != null;
      if (condition === 'XX' ? !exists : exists) return null;
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

/**
 * 每個操作延遲幾毫秒的儲存，模擬 Redis 的網路往返：兩個操作之間的空窗才重現得出競態。
 */
export function slowStore(store: BindingStore, ms = 3): BindingStore {
  const wait = () => new Promise((r) => setTimeout(r, ms));
  return new Proxy(store, {
    get(target, prop, receiver) {
      const fn = Reflect.get(target, prop, receiver);
      if (typeof fn !== 'function') return fn;
      return async (...args: unknown[]) => {
        await wait();
        return fn.apply(target, args);
      };
    },
  });
}
