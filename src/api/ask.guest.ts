import type {
  EventPairs,
  GuestToHostBusinessPayloads,
  GuestToHostEventPayloads,
  HostToGuestBusinessPayloads,
  HostToGuestEventPayloads,
} from 'askit/contracts';
import { EVENT_PAIRS } from 'askit/contracts';

/**
 * ask —— Guest 与 Host 通信的统一入口（模块级单例，每沙箱一份）
 *
 * 三个原语对应契约的三类通信语义：
 * - call：请求-响应对（EventPairs），RPC 语义
 * - send：单向通知宿主（guestToHost 中未声明 response 的事件）
 * - on  ：订阅宿主推送（hostToGuest 事件）
 *
 * 底层通道为 keel 运行时注入的全局 __keel_emitEvent / __keel_onHostEvent
 * （与 keel sdk 的 useSendToHost / useHostEvent 同源），askit 只做契约类型化。
 *
 * call 的请求-响应关联依赖「沙箱内唯一 requestId + host 沿发起请求的 engine
 * 通道定向回发」：每个 tab 持有独立 QuickJS realm，跨 guest 不可能串台，
 * 因此模块级计数器已保证唯一性。
 */

type PendingRequest = {
  requestEvent: string;
  resolve: (res: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** keel 运行时注入沙箱的桥接全局（见 keel sandbox/globals.ts 与 RUNTIME_HELPERS_CODE） */
type KeelBridgeGlobal = {
  __keel_emitEvent?: (eventName: string, payload?: unknown) => void;
  __keel_onHostEvent?: (eventName: string, cb: (payload: unknown) => void) => () => void;
};

function bridge(): KeelBridgeGlobal {
  return globalThis as unknown as KeelBridgeGlobal;
}

const pendingRequests = new Map<string, PendingRequest>();
/** 已注册 dispatcher 的响应事件（同一响应事件全沙箱只订阅一次） */
const dispatchedResponses = new Set<string>();

/** 沙箱内单调递增的请求序号（见文件头注释：跨 guest 由通道隔离保证不串台） */
let requestSeq = 0;

function nextRequestId(requestEvent: string): string {
  requestSeq += 1;
  return `${requestEvent}-${requestSeq}`;
}

/**
 * 为响应事件惰性注册 dispatcher：按 requestId 分发到对应 Promise。
 * 迟到的重复响应 / 无关 requestId 静默忽略（pending 已被清除）。
 */
function ensureResponseDispatcher(responseEvent: string): void {
  if (dispatchedResponses.has(responseEvent)) return;
  dispatchedResponses.add(responseEvent);

  const onHostEvent = bridge().__keel_onHostEvent;
  if (typeof onHostEvent !== 'function') {
    console.warn(
      `[ask] 通道不可用：__keel_onHostEvent 未注入，${responseEvent} 的响应将无法接收（不在 keel 沙箱内？）`
    );
    return;
  }

  onHostEvent(responseEvent, (res) => {
    const payload = res as { requestId?: string };
    const key = `${responseEvent}:${String(payload.requestId)}`;
    const pending = pendingRequests.get(key);

    if (!pending) return;
    pendingRequests.delete(key);
    clearTimeout(pending.timer);

    // 应用层错误：契约中带 success 布尔字段的响应，失败按 reject 处理，
    // 让 await 的 catch 语义完整（传输层超时之外的第二种失败通道）
    const outcome = res as { success?: unknown; error?: unknown };
    if (typeof outcome.success === 'boolean' && !outcome.success) {
      const detail = outcome.error === undefined ? '' : `: ${String(outcome.error)}`;
      pending.reject(new Error(`[ask] ${pending.requestEvent} failed${detail}`));
      return;
    }

    pending.resolve(res);
  });
}

/** call 的可选配置 */
type CallOptions = { timeoutMs?: number };

/**
 * call 参数的条件元组：payload 无必填字段时可整体省略（GET_APP_INFO 这类无参请求），
 * 有必填字段时（SET_APP_LANGUAGE 的 language）漏传直接编译报错。
 */
type CallArgs<P> =
  Partial<P> extends P ? [payload?: P, options?: CallOptions] : [payload: P, options?: CallOptions];

/** send 的载荷元组：同上判定，全可选时可省略 */
type OptionalPayload<P> = Partial<P> extends P ? [payload?: P] : [payload: P];

export const ask = {
  /**
   * 调用宿主能力并等待响应
   *
   * @param request 契约中的请求事件名（响应事件由 EventPairs 查表，无需声明）
   * @param args.payload 业务载荷（requestId 由本方法自动生成并注入，类型不含它；
   *   无必填字段时可省略，有必填字段时漏传编译报错）
   * @param args.options.timeoutMs 超时毫秒数，默认 10 秒
   */
  call<K extends keyof EventPairs>(
    request: K,
    ...args: CallArgs<GuestToHostBusinessPayloads[K]>
  ): Promise<HostToGuestBusinessPayloads[EventPairs[K]]> {
    const [payload, options] = args;
    const responseEvent = EVENT_PAIRS[request];
    const requestId = nextRequestId(String(request));
    const key = `${String(responseEvent)}:${requestId}`;
    const timeoutMs = options?.timeoutMs ?? 10000;

    ensureResponseDispatcher(String(responseEvent));

    // 返回业务载荷类型（requestId 是管道字段，调用方不需要）；运行时响应对象
    // 含 requestId，结构兼容直接透传
    return new Promise<HostToGuestBusinessPayloads[EventPairs[K]]>((resolve, reject) => {
      const emit = bridge().__keel_emitEvent;
      if (typeof emit !== 'function') {
        reject(new Error('[ask] 通道不可用：__keel_emitEvent 未注入（不在 keel 沙箱内？）'));
        return;
      }

      const timer = setTimeout(() => {
        if (pendingRequests.delete(key)) {
          reject(
            new Error(
              `[ask] Timeout: ${String(request)} -> ${String(responseEvent)} (ID: ${requestId})`
            )
          );
        }
      }, timeoutMs);

      // 单例 map 存 unknown；responseEvent 已由 call 的 K 锁定，
      // resolve 处的擦除与 host 侧 EventHandler 分发同源同构
      pendingRequests.set(key, {
        requestEvent: String(request),
        resolve: resolve as (res: unknown) => void,
        reject,
        timer,
      });
      emit(String(request), { ...payload, requestId });
    });
  },

  /**
   * 单向通知宿主（fire-and-forget，无响应）
   *
   * 只接受未声明 response 的通知类事件——配对事件必须走 call（否则宿主
   * 响应无人接收）。通知类事件无管道字段，payload 即契约业务载荷。
   *
   * @param event 契约中的 guestToHost 通知事件名
   */
  send<K extends Exclude<keyof GuestToHostEventPayloads, keyof EventPairs>>(
    event: K,
    ...payload: OptionalPayload<GuestToHostEventPayloads[K]>
  ): void {
    const emit = bridge().__keel_emitEvent;
    if (typeof emit !== 'function') {
      console.warn(`[ask] send 丢弃：__keel_emitEvent 未注入（事件 ${String(event)}）`);
      return;
    }
    emit(String(event), payload[0]);
  },

  /**
   * 订阅宿主推送事件
   *
   * @returns 取消订阅函数
   */
  on<K extends keyof HostToGuestEventPayloads>(
    event: K,
    listener: (payload: HostToGuestEventPayloads[K]) => void
  ): () => void {
    const onHostEvent = bridge().__keel_onHostEvent;
    if (typeof onHostEvent !== 'function') {
      console.warn(`[ask] on 丢弃：__keel_onHostEvent 未注入（事件 ${String(event)}）`);
      return () => {};
    }
    return onHostEvent(String(event), listener as (payload: unknown) => void);
  },
};
