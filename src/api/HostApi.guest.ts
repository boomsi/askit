import type { GuestToHostEventPayloads, HostToGuestEventPayloads } from 'askit/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { useHostEvent, useSendToHost } from 'keel/guest';

type RequestPayloadWithId = {
  requestId: string;
};

type PendingRequest<TResponse> = {
  resolve: (res: TResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * 通用的宿主 API 桥接 Hook
 * 将“请求-响应”类型的事件对封装为 Promise 调用
 *
 * @param requestEvent Guest 发送给 Host 的请求事件 (如: 'HTTP_REQUEST')
 * @param responseEvent Host 返回给 Guest 的响应事件 (如: 'HTTP_RESPONSE')
 */
export function useHostApi<
  TReqName extends keyof GuestToHostEventPayloads,
  TResName extends keyof HostToGuestEventPayloads,
>(requestEvent: TReqName, responseEvent: TResName) {
  const send = useSendToHost();
  const pendingRequestsRef = useRef(
    new Map<string, PendingRequest<HostToGuestEventPayloads[TResName]>>()
  );
  const isDisposedRef = useRef(false);

  // 组件卸载时主动结束所有未完成请求，避免内存泄漏与对失效实例的回写
  useEffect(() => {
    isDisposedRef.current = false;
    return () => {
      isDisposedRef.current = true;
      pendingRequestsRef.current.forEach((entry, key) => {
        clearTimeout(entry.timer);
        entry.reject(
          new Error(
            `[useHostApi] Disposed: ${String(requestEvent)} -> ${String(responseEvent)} (${key})`
          )
        );
      });
      pendingRequestsRef.current.clear();
    };
  }, [requestEvent, responseEvent]);

  // 监听响应事件，按 requestId 分发到对应 Promise
  useHostEvent<HostToGuestEventPayloads[TResName]>(
    responseEvent,
    (res: HostToGuestEventPayloads[TResName]) => {
      const payload = res as RequestPayloadWithId;
      const key = `${String(responseEvent)}:${payload.requestId}`;
      const pending = pendingRequestsRef.current.get(key);

      if (!pending) return;
      pendingRequestsRef.current.delete(key);
      clearTimeout(pending.timer);
      if (isDisposedRef.current) return;
      pending.resolve(res);
    }
  );

  /**
   * 发起请求并等待响应
   * @param payload 符合合约定义的请求载荷
   * @param timeoutMs 超时时间，默认 10 秒
   */
  const request = useCallback(
    async (
      payload: GuestToHostEventPayloads[TReqName],
      timeoutMs = 10000
    ): Promise<HostToGuestEventPayloads[TResName]> => {
      const { requestId } = payload as RequestPayloadWithId;
      if (!requestId) {
        throw new Error(`[useHostApi] requestId is required for ${String(requestEvent)}`);
      }

      const key = `${String(responseEvent)}:${requestId}`;

      return new Promise<HostToGuestEventPayloads[TResName]>((resolve, reject) => {
        if (isDisposedRef.current) {
          reject(
            new Error(
              `[useHostApi] Disposed before request: ${String(requestEvent)} -> ${String(responseEvent)} (ID: ${requestId})`
            )
          );
          return;
        }

        const timer = setTimeout(() => {
          if (pendingRequestsRef.current.has(key)) {
            pendingRequestsRef.current.delete(key);
            reject(
              new Error(
                `[useHostApi] Timeout: ${String(requestEvent)} -> ${String(responseEvent)} (ID: ${requestId})`
              )
            );
          }
        }, timeoutMs);

        pendingRequestsRef.current.set(key, { resolve, reject, timer });
        send(requestEvent, payload);
      });
    },
    [send, requestEvent, responseEvent]
  );

  return { request };
}
