import { afterEach, describe, expect, it } from 'bun:test';
import { HostHttpHandler } from './Https.host';

const originalFetch = globalThis.fetch;

function mockFetch(response: {
  ok: boolean;
  status: number;
  headers: { get: (k: string) => string | null };
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) {
  (globalThis as unknown as { fetch: unknown }).fetch = () => Promise.resolve(response);
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe('HostHttpHandler', () => {
  afterEach(restoreFetch);

  it('成功 JSON 响应', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ a: 1 }),
    });
    const res = await HostHttpHandler.handleRequest({ url: 'http://x' });
    expect(res.success).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ a: 1 });
  });

  it('非 JSON 响应返回 text', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('hello'),
    });
    const res = await HostHttpHandler.handleRequest({ url: 'http://x' });
    expect(res.data).toBe('hello');
  });

  it('fetch 失败归一 status:0', async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = () =>
      Promise.reject(new Error('network'));
    const res = await HostHttpHandler.handleRequest({ url: 'http://x' });
    expect(res.success).toBe(false);
    expect(res.status).toBe(0);
    expect((res.data as { message: string }).message).toBe('network');
  });

  it('POST 对象 body 补 application/json', async () => {
    let capturedInit: RequestInit | undefined;
    (globalThis as unknown as { fetch: unknown }).fetch = (_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
      });
    };
    await HostHttpHandler.handleRequest({
      url: 'http://x',
      method: 'POST',
      body: { k: 1 },
    });
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBe(JSON.stringify({ k: 1 }));
    const h = new Headers(capturedInit?.headers);
    expect(h.get('content-type')).toBe('application/json');
  });

  it('GET 默认方法', async () => {
    let capturedInit: RequestInit | undefined;
    (globalThis as unknown as { fetch: unknown }).fetch = (_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      });
    };
    await HostHttpHandler.handleRequest({ url: 'http://x' });
    expect(capturedInit?.method).toBe('GET');
    expect(capturedInit?.body).toBeUndefined();
  });
});
