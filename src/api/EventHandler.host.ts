import type { GuestToHostEventPayloads, HostToGuestEventPayloads } from 'askit/contracts';
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

type HandlerFunc<
  K extends keyof GuestToHostEventPayloads,
  V extends keyof HostToGuestEventPayloads,
> = (payload: GuestToHostEventPayloads[K], tabId?: string) => Promise<HostToGuestEventPayloads[V]>;

type HandlerEntry<
  K extends keyof GuestToHostEventPayloads,
  V extends keyof HostToGuestEventPayloads,
> = {
  responseEvent: V;
  handle: HandlerFunc<K, V>;
};

// 按 K 泛型化的 handler 条目：V 在 HostToGuestEventPayloads 全键上取联合，
// payload 类型按 K 锁定到 GuestToHostEventPayloads[K]，让调用方在编写 handler 时拿到精确类型。
type AnyHandlerEntry<K extends keyof GuestToHostEventPayloads> = {
  [V in keyof HostToGuestEventPayloads]: HandlerEntry<K, V>;
}[keyof HostToGuestEventPayloads];

export type HandlerRegistry = Partial<{
  [K in keyof GuestToHostEventPayloads]: AnyHandlerEntry<K>;
}>;

function isRegisteredEvent(
  event: string,
  handlers: HandlerRegistry
): event is keyof GuestToHostEventPayloads {
  return event in handlers;
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
    HTTP_REQUEST: {
      responseEvent: 'HTTP_RESPONSE',
      handle: (payload) => HostHttpHandler.handleRequest(payload),
    },
    // 占位实现：宿主应通过 setup 的 customHandlers 覆盖，提供真实应用信息
    GET_APP_INFO: {
      responseEvent: 'SEND_APP_INFO',
      handle: async (payload) => {
        const { requestId } = payload;
        return {
          requestId,
          appName: '',
          logo: '',
          languageContents: null,
          favoriteCount: 0,
          usedCount: 0,
          author: '',
        };
      },
    },
  };

  // 按 K 泛型化的分发：编译期锁定 payload 与 handler 的对应关系。
  // setup 入口拿到的是 string + unknown，通过 isRegisteredEvent 收窄 K 后调用本方法，
  // 在 K 已确定的作用域内，payload cast 到 GuestToHostEventPayloads[K] 是诚实的类型擦除。
  private static async handleKnownEvent<K extends keyof GuestToHostEventPayloads>(
    engine: Engine,
    event: K,
    payload: GuestToHostEventPayloads[K],
    tabId: string,
    onLog: MessageLogHandler | undefined,
    customHandlers: HandlerRegistry | undefined
  ) {
    const handler = customHandlers?.[event] ?? EventHandler.handlers[event];
    if (!handler) {
      console.warn(`[EventHandler] 无对应处理器: ${event}`);
      return;
    }

    const responsePayload = await handler.handle(payload, tabId);
    engine.sendEvent(handler.responseEvent, responsePayload);
    if (onLog) {
      onLog('hostToGuest', handler.responseEvent, responsePayload, tabId);
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
