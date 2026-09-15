import { CliError } from './errors.js';

export interface Open333Response<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface ApiClientOptions {
  host: string;
  token?: string;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly host: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.host = options.host.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async health(): Promise<unknown> {
    return this.requestRaw('/health');
  }

  async get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.requestJson<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return this.requestJson<T>('POST', path, body, options);
  }

  private async requestRaw(path: string, options?: { signal?: AbortSignal }): Promise<unknown> {
    const response = await this.fetch(path, { method: 'GET' }, options);
    if (!response.ok) {
      throw new CliError(`Server health check failed (${response.status})`, 'HEALTH_FAILED', response.status);
    }
    return response.json().catch(() => ({}));
  }

  private async requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    const response = await this.fetch(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      options,
    );
    const payload = (await response.json().catch(() => ({}))) as Open333Response<T>;

    if (!response.ok || payload.success === false) {
      const message = payload.error?.message ?? `Open333 API request failed (${response.status})`;
      const code = payload.error?.code ?? 'API_ERROR';
      throw new CliError(message, code, response.status);
    }
    if (!payload.data) {
      throw new CliError('Open333 API returned an empty response', 'EMPTY_RESPONSE', response.status);
    }
    return payload.data;
  }

  private async fetch(path: string, init: RequestInit, options?: { signal?: AbortSignal }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    try {
      const headers = new Headers(init.headers);
      if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
      return await fetch(`${this.host}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (options?.signal?.aborted) {
        throw new CliError('Request aborted by signal', 'REQUEST_ABORTED', 130);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError(`Request timed out after ${this.timeoutMs}ms`, 'REQUEST_TIMEOUT');
      }
      throw new CliError(`Cannot reach Open333 host ${this.host}`, 'HOST_UNREACHABLE');
    } finally {
      clearTimeout(timer);
      if (options?.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}
