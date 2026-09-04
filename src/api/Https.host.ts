import type { GuestToHostBusinessPayloads, HostToGuestBusinessPayloads } from 'askit/contracts';

type THttpRequest = GuestToHostBusinessPayloads['HTTP_REQUEST'];
export type THttpResponse = HostToGuestBusinessPayloads['HTTP_RESPONSE'];

type HttpHeaders = Record<string, string>;

const DEFAULT_TIMEOUT_MS = 10_000;

export class HostHttpHandler {
  /**
   * 处理来自 Guest 的 HTTP 请求
   * @param payload 请求负载
   */
  static async handleRequest(payload: THttpRequest): Promise<THttpResponse> {
    const { url, method = 'GET', headers, body } = payload;

    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: (headers as HttpHeaders | undefined) ?? {},
        signal: controller.signal as never, // AbortSignal 在 node/dom lib 间类型冲突，用 never 绕过
      };

      // 非 GET/HEAD 请求处理 body
      if (body && !['GET', 'HEAD'].includes(fetchOptions.method ?? 'GET')) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);

        // 对象 body 且未设 Content-Type 时补 application/json
        const h = new Headers(fetchOptions.headers);
        if (!h.has('content-type') && typeof body !== 'string') {
          h.set('content-type', 'application/json');
          fetchOptions.headers = h;
        }
      }

      const response = await fetch(url, fetchOptions);

      const contentType = response.headers.get('content-type');
      const data: unknown = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();

      return {
        success: response.ok,
        status: response.status,
        data,
      };
    } catch (error) {
      console.error(`[HostHttpHandler] 请求失败 (${url}):`, error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 0,
        success: false,
        data: { message },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
