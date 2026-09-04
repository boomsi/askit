import type {
  EventPairs,
  GuestToHostBusinessPayloads,
  GuestToHostEventPayloads,
  HostToGuestBusinessPayloads,
} from 'askit/contracts';
import { EVENT_PAIRS } from 'askit/contracts';
import { HostHttpHandler } from './Https.host';

/**
 * 本地 Engine 最小契约（structural）
 * 只声明 EventHandler 实际依赖的方法，避免直接 import keel/host 触发对 keel 源码的类型扫描。
 */
type Engine = {
  on(
    event: 'message',
    cb: (msg: { event: string; payload?: unknown }) => void | Promise<void>
  ): () => void;
  sendEvent(event: string, payload: unknown): void;
};

/**
 * 日志处理器接口，通常对应 DevToolsBridge.logMessage
 */
export type MessageLogHandler = (
  direction: 'guestToHost' | 'hostToGuest',
  event: string,
  payload: unknown,
  tabId?: string
) => void;

// 请求-响应配对由契约生成的 EventPairs 锁定：响应事件由 EventHandler 分发时查表，
// 宿主只声明业务函数（入参/返回类型按事件对精确推导），配对只存在于契约一处。
export type HandlerRegistry = Partial<{
  [K in keyof EventPairs]: (
    payload: GuestToHostBusinessPayloads[K],
    tabId?: string
  ) => Promise<HostToGuestBusinessPayloads[EventPairs[K]]>;
}>;

function isRegisteredEvent(event: string, handlers: HandlerRegistry): event is keyof EventPairs {
  // hasOwnProperty.call 而非 in：in 走原型链，'toString'/'constructor' 等继承属性会命中，
  // Object.prototype 方法会被误当 handler 调用，且 EVENT_PAIRS 查不到对应响应事件。
  // （lib=ES2020 无 Object.hasOwn，QuickJS 兼容性优先于新语法）
  // biome-ignore lint/suspicious/noPrototypeBuiltins: 见上，ES2020 lib 下无 Object.hasOwn
  return Object.prototype.hasOwnProperty.call(handlers, event);
}

/**
 * EventHandler - 统一处理 Guest 发往 Host 的消息分发
 *
 * - Registry 模式：将分散的 if-else 收敛为注册表，易于扩展
 * - 插件化：通过 setup 注入日志回调和自定义 handler（覆盖默认）
 * - 容错：try-catch 保护，单个 Handler 崩溃不影响整体
 */
export class EventHandler {
  private static handlers: HandlerRegistry = {
    HTTP_REQUEST: (payload) => HostHttpHandler.handleRequest(payload),
    // 占位实现：宿主应通过 setup 的 customHandlers 覆盖，提供真实应用信息
    GET_APP_INFO: async () => ({
      appName: '',
      logo: '',
      languageContents: null,
      favoriteCount: 0,
      usedCount: 0,
      author: '',
    }),
  };

  // 按 K 泛型化的分发：编译期锁定 payload 与 handler 的对应关系。
  // setup 入口拿到的是 string + unknown，通过 isRegisteredEvent 收窄 K 后调用本方法，
  // 在 K 已确定的作用域内，payload cast 到 GuestToHostEventPayloads[K] 是诚实的类型擦除。
  private static async handleKnownEvent<K extends keyof EventPairs>(
    engine: Engine,
    event: K,
    payload: GuestToHostEventPayloads[K], // 完整线上载荷（含 requestId），handler 入参收窄为业务字段
    tabId: string,
    onLog: MessageLogHandler | undefined,
    customHandlers: HandlerRegistry | undefined
  ) {
    const handler = customHandlers?.[event] ?? EventHandler.handlers[event];
    if (!handler) {
      console.warn(`[EventHandler] 无对应处理器: ${event}`);
      return;
    }

    // 响应事件由契约配对表查得，宿主 registry 不再声明（配对唯一存在于契约）；
    // requestId 是管道字段，handler 返回纯业务结果，分发时统一注入回传。
    // 入参 cast：运行时对象带 requestId（多一字段，结构兼容），泛型映射类型
    // 间 TS 无法验证重叠，经 unknown 擦除（handler 侧只见业务字段）
    const responseEvent = EVENT_PAIRS[event];
    const businessPayload = await handler(
      payload as unknown as GuestToHostBusinessPayloads[K],
      tabId
    );
    const responsePayload = { ...businessPayload, requestId: payload.requestId };
    engine.sendEvent(responseEvent, responsePayload);
    if (onLog) {
      onLog('hostToGuest', responseEvent, responsePayload, tabId);
    }
  }

  static setup(
    engine: Engine,
    options: {
      tabId: string;
      onLog?: MessageLogHandler;
      handlers?: HandlerRegistry;
    }
  ): () => void {
    const { tabId, onLog, handlers: customHandlers } = options;

    if (!tabId) {
      console.warn('[EventHandler] No tabId provided, skipping event handler setup.');
      return () => {};
    }

    return engine.on('message', async (msg: { event: string; payload?: unknown }) => {
      const { event, payload } = msg;

      if (onLog) {
        onLog('guestToHost', event, payload, tabId);
      }

      if (!isRegisteredEvent(event, { ...EventHandler.handlers, ...customHandlers })) {
        console.warn(`[EventHandler] 无对应处理器: ${event}`);
        return;
      }

      try {
        // isRegisteredEvent 把 event 收窄为 keyof GuestToHostEventPayloads；
        // engine.on 的 payload 是 unknown，cast 到对应 K 的 payload 类型是运行时唯一的类型擦除点。
        await EventHandler.handleKnownEvent(
          engine,
          event,
          payload as GuestToHostEventPayloads[typeof event],
          tabId,
          onLog,
          customHandlers
        );
      } catch (error) {
        console.error(`[EventHandler] 处理事件 "${event}" 时发生异常:`, error);
      }
    });
  }
}
