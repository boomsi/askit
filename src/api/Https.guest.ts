import type { HostToGuestBusinessPayloads } from 'askit/contracts';
import { ask } from './ask.guest';

type HttpResult = HostToGuestBusinessPayloads['HTTP_RESPONSE'];
export type HttpResponse<D> = Omit<HttpResult, 'data'> & { data: D };

type HttpHeaders = Record<string, string>;

/**
 * HTTP 客户端：契约事件对 HTTP_REQUEST / HTTP_RESPONSE 的特化层。
 * 构建在 ask.call 之上（requestId 自动生成、超时与失败 reject 由 ask 内建），
 * data 类型由调用方泛型 D 指定（契约中 data 为 unknown）。
 */
export const http = {
  get<D>(url: string, headers?: HttpHeaders): Promise<HttpResponse<D>> {
    return ask.call('HTTP_REQUEST', { url, method: 'GET', headers }).then((res) => ({
      ...res,
      data: res.data as D,
    }));
  },

  post<D>(url: string, body?: unknown, headers?: HttpHeaders): Promise<HttpResponse<D>> {
    return ask.call('HTTP_REQUEST', { url, method: 'POST', body, headers }).then((res) => ({
      ...res,
      data: res.data as D,
    }));
  },
};
