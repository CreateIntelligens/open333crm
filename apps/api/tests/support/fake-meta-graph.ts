/**
 * Graph API 的 fetch 替身（change add-comment-keyword-private-reply，planning/05-qa.md §4.3、SEC-01）。
 *
 * - 依「method＋host＋path」設定回應；回應可依呼叫次數變化、可延遲。
 * - 記錄每一次呼叫（網址、method、header、body；form 與 JSON body 會解析）。
 * - 白名單以外的 host、或白名單內但沒有設定回應的路徑，記成違規並丟錯；
 *   外掛會把 fetch 丟錯當成網路錯誤吞掉，所以違規另外在 afterEach 以 assertNoViolations() 讓測試失敗
 *   （useFakeMetaGraph() 會自動掛上）。
 *
 * 用法：
 *   const graph = useFakeMetaGraph();
 *   graph.on('POST', 'graph.facebook.com', '/v21.0/me/messages', { body: { recipient_id: 'PSID-1', message_id: 'm_1' } });
 *   ...
 *   assert.equal(graph.calls('POST', '/v21.0/me/messages').length, 1);
 */
import { afterEach, beforeEach } from 'vitest';

export const META_GRAPH_HOSTS = ['graph.facebook.com', 'graph.instagram.com'] as const;

export interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** 回應前等待的毫秒數（測逾時用） */
  delayMs?: number;
  /** 直接丟錯（模擬網路錯誤） */
  throwError?: string;
}

export interface RecordedCall {
  method: string;
  url: string;
  host: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** 原始 body 字串 */
  rawBody: string | null;
  /** JSON 或 x-www-form-urlencoded 解析後的 body；無法解析時為 null */
  body: Record<string, any> | null;
  /** 這條路由第幾次被呼叫（從 1 起算） */
  nth: number;
}

type Responder = FakeResponse | ((call: RecordedCall) => FakeResponse | Promise<FakeResponse>);

interface Route {
  method: string;
  host: string;
  path: string | RegExp;
  responders: Responder[];
  count: number;
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function parseBody(raw: string | null, contentType: string | undefined): Record<string, any> | null {
  if (raw == null || raw === '') return null;
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    // 沒有 content-type 的 form body
    if (raw.includes('=')) return Object.fromEntries(new URLSearchParams(raw));
    return null;
  }
}

export class FakeMetaGraph {
  readonly recorded: RecordedCall[] = [];
  readonly violations: string[] = [];
  private routes: Route[] = [];
  private originalFetch: typeof fetch | null = null;
  private readonly allowHosts: Set<string>;

  constructor(options: { extraAllowedHosts?: string[] } = {}) {
    this.allowHosts = new Set<string>([...META_GRAPH_HOSTS, ...(options.extraAllowedHosts ?? [])]);
  }

  /**
   * 設定一條路由的回應。給多個 responder 時依呼叫次數依序使用，用完後重複最後一個
   * （例如「第一次網路錯誤、第二次成功」）。
   */
  on(method: string, host: string, path: string | RegExp, ...responders: Responder[]): this {
    if (!responders.length) responders = [{ status: 200, body: {} }];
    this.routes.unshift({ method: method.toUpperCase(), host, path, responders, count: 0 });
    return this;
  }

  /** 依 method 與 path（可只給 path）篩出呼叫紀錄 */
  calls(method?: string, path?: string | RegExp, host?: string): RecordedCall[] {
    return this.recorded.filter(
      (c) =>
        (!method || c.method === method.toUpperCase()) &&
        (!host || c.host === host) &&
        (!path || (typeof path === 'string' ? c.path === path : path.test(c.path))),
    );
  }

  install(): void {
    if (this.originalFetch) return;
    this.originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => this.handle(input, init)) as typeof fetch;
  }

  restore(): void {
    if (this.originalFetch) globalThis.fetch = this.originalFetch;
    this.originalFetch = null;
  }

  reset(): void {
    this.recorded.length = 0;
    this.violations.length = 0;
    this.routes = [];
  }

  assertNoViolations(): void {
    if (this.violations.length) {
      const list = this.violations.join('\n  ');
      this.violations.length = 0;
      throw new Error(`fake-meta-graph 攔到不該發生的對外呼叫：\n  ${list}`);
    }
  }

  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const headers = headersToRecord(init?.headers ?? req?.headers);
    let rawBody: string | null = null;
    if (init?.body != null) rawBody = typeof init.body === 'string' ? init.body : String(init.body);
    else if (req && method !== 'GET' && method !== 'HEAD') rawBody = await req.clone().text();

    if (!this.allowHosts.has(url.host)) {
      this.violations.push(`${method} ${url.origin}${url.pathname}（白名單外的 host）`);
      throw new Error(`fake-meta-graph: 不允許連線到 ${url.host}`);
    }

    const route = this.routes.find(
      (r) =>
        r.method === method &&
        r.host === url.host &&
        (typeof r.path === 'string' ? r.path === url.pathname : r.path.test(url.pathname)),
    );
    const call: RecordedCall = {
      method,
      url: url.toString(),
      host: url.host,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      rawBody,
      body: parseBody(rawBody, headers['content-type']),
      nth: 0,
    };
    this.recorded.push(call);

    if (!route) {
      this.violations.push(`${method} ${url.host}${url.pathname}（沒有設定回應）`);
      throw new Error(`fake-meta-graph: 沒有設定 ${method} ${url.host}${url.pathname} 的回應`);
    }
    route.count += 1;
    call.nth = route.count;
    const responder = route.responders[Math.min(route.count - 1, route.responders.length - 1)]!;
    const res = typeof responder === 'function' ? await responder(call) : responder;
    if (res.delayMs) await new Promise((r) => setTimeout(r, res.delayMs));
    if (res.throwError) throw new TypeError(res.throwError);
    return new Response(res.body === undefined ? '{}' : JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { 'content-type': 'application/json', ...(res.headers ?? {}) },
    });
  }
}

/** 每個測試前裝上替身並清空設定，測試後檢查違規並還原 fetch */
export function useFakeMetaGraph(options: { extraAllowedHosts?: string[] } = {}): FakeMetaGraph {
  const graph = new FakeMetaGraph(options);
  beforeEach(() => {
    graph.reset();
    graph.install();
  });
  afterEach(() => {
    graph.restore();
    graph.assertNoViolations();
  });
  return graph;
}
