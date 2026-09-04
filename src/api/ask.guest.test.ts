/**
 * ask 单例测试
 *
 * ask 直连 keel 注入的全局通道（__keel_emitEvent / __keel_onHostEvent），
 * 无 react/模块依赖，测试直接在 globalThis 上注入同语义的桩：
 * - __keel_onHostEvent：订阅表（host→guest 推送 / 响应回发）
 * - __keel_emitEvent：发送记录（guest→host）
 *
 * 注意：ask 的 dispatcher / 订阅是模块级单例（每沙箱一份，常驻不可撤销），
 * 因此注入函数与订阅表只在文件顶层定义、不跨用例清空——
 * 这与真实沙箱「polyfill 先于 bundle 注入且常驻」的语义一致；
 * beforeEach 仅清空发送记录与注册统计。
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { EVENT_PAIRS, GUEST_TO_HOST_EVENT_NAMES, HOST_TO_GUEST_EVENT_NAMES } from '../contracts';
import { AskError, ask } from '../index.guest'; // 公开入口导入：防止内部路径掩盖导出缺口
import { http } from './Https.guest';

type HostListener = (payload: unknown) => void;

const hostListeners = new Map<string, Set<HostListener>>();
let sentEvents: Array<{ event: string; payload: Record<string, unknown> }>;
let onHostEventRegistrations: string[];

type KeelBridgeGlobal = {
  __keel_emitEvent?: (eventName: string, payload?: unknown) => void;
  __keel_onHostEvent?: (eventName: string, cb: HostListener) => () => void;
};

const g = globalThis as unknown as KeelBridgeGlobal;
const originalEmit = g.__keel_emitEvent;
const originalOnHostEvent = g.__keel_onHostEvent;

// 一次性注入（引用稳定，dispatcher 只捕获一次）
g.__keel_emitEvent = (event: string, payload?: unknown) => {
  sentEvents.push({ event, payload: (payload ?? {}) as Record<string, unknown> });
};
g.__keel_onHostEvent = (event: string, cb: HostListener) => {
  onHostEventRegistrations.push(event);
  let set = hostListeners.get(event);
  if (!set) {
    set = new Set();
    hostListeners.set(event, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
};

/** 模拟 host 定向回发（只有订阅了该事件的 listener 会收到） */
function emitHostEvent(name: string, payload: unknown): void {
  for (const cb of hostListeners.get(name) ?? []) cb(payload);
}

function lastSent(): { event: string; payload: Record<string, unknown> } {
  const last = sentEvents[sentEvents.length - 1];
  if (!last) throw new Error('没有任何已发送事件');
  return last;
}

afterAll(() => {
  g.__keel_emitEvent = originalEmit;
  g.__keel_onHostEvent = originalOnHostEvent;
});

beforeEach(() => {
  sentEvents = [];
  onHostEventRegistrations = [];
});

describe('ask.call: 自动 requestId', () => {
  it('不传 payload 时自动生成 requestId 并随事件发出', () => {
    void ask.call('GET_APP_INFO');

    const sent = lastSent();
    expect(sent.event).toBe('GET_APP_INFO');
    expect(sent.payload.requestId).toMatch(/^GET_APP_INFO-\d+$/);
  });

  it('连续请求的 requestId 严格递增不重复', () => {
    void ask.call('GET_APP_INFO');
    void ask.call('GET_APP_INFO');

    const ids = sentEvents.map(({ payload }) => String(payload.requestId));
    expect(new Set(ids).size).toBe(2);
  });

  it('业务字段透传，且不会覆盖自动生成的 requestId', () => {
    void ask.call('HTTP_REQUEST', { url: 'https://example.com', method: 'GET' });

    const sent = lastSent();
    expect(sent.payload.url).toBe('https://example.com');
    expect(sent.payload.method).toBe('GET');
    expect(sent.payload.requestId).toMatch(/^HTTP_REQUEST-\d+$/);
  });

  it('类型保护（编译期，@ts-expect-error 若类型退化会在 typecheck 暴露）', () => {
    // 事件名不在契约配对表内
    // @ts-expect-error 不存在的事件名
    void ask.call('GET_APP_INF');
    // @ts-expect-error language 必须是 string
    void ask.call('SET_APP_LANGUAGE', { language: 123 });
    // @ts-expect-error 有必填字段的事件不能省略 payload
    void ask.call('SET_APP_LANGUAGE');
    // @ts-expect-error send 的 payload 类型错
    ask.send('GUEST_SLEEP_STATE', { sleeping: 'yes' });
    // 空业务载荷事件：非对象值 / 多余属性都必须拒绝（Record<string, never>）
    // @ts-expect-error payload 不接受非对象值
    void ask.call('GET_APP_INFO', 123);
    // @ts-expect-error payload 不接受多余属性
    void ask.call('GET_APP_INFO', { foo: 1 });
  });
});

describe('ask.call: 请求-响应关联', () => {
  it('响应 requestId 匹配时 resolve 并返回完整响应载荷', async () => {
    const pending = ask.call('GET_APP_INFO');

    const { requestId } = lastSent().payload;
    emitHostEvent('SEND_APP_INFO', { requestId, appName: 'demo' });

    const res = (await pending) as { appName?: string };
    expect(res.appName).toBe('demo');
    // 边界拆分：requestId 是管道字段，resolve 值运行时不含它
    expect(res).not.toHaveProperty('requestId');
  });

  it('响应 requestId 不匹配时保持 pending（不误吞其他请求的响应）', async () => {
    const pending = ask.call('GET_APP_INFO');

    emitHostEvent('SEND_APP_INFO', { requestId: '别人的-id', appName: 'other' });

    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
  });

  it('同一响应事件的 dispatcher 只注册一次（重复 call 不重复订阅）', () => {
    // 断言「不随 call 次数线性增长」：若每次 call 都注册，此处应为 3
    void ask.call('SEND_EMAIL', { to: 'a@b.c', subject: 'hi' });
    void ask.call('SEND_EMAIL', { to: 'd@e.f', subject: 'hi' });
    void ask.call('SEND_EMAIL', { to: 'g@h.i', subject: 'hi' });

    const count = onHostEventRegistrations.filter((e) => e === 'SEND_EMAIL_RESULT').length;
    expect(count).toBeLessThanOrEqual(1);
  });
});

describe('ask.call: 应用层错误（success:false）', () => {
  it('success:false 的响应被 reject，error 信息进入错误消息', async () => {
    const pending = ask.call('SET_APP_LANGUAGE', { language: 'en' });

    const { requestId } = lastSent().payload;
    emitHostEvent('SET_APP_LANGUAGE_RESULT', {
      requestId,
      success: false,
      error: 'not supported',
    });

    let message = '';
    await pending.catch((err: Error) => {
      message = err instanceof Error ? err.message : String(err);
    });
    expect(message).toContain('failed');
    expect(message).toContain('not supported');
  });

  it('success:true 的响应正常 resolve', async () => {
    const pending = ask.call('SET_APP_LANGUAGE', { language: 'en' });

    const { requestId } = lastSent().payload;
    emitHostEvent('SET_APP_LANGUAGE_RESULT', { requestId, success: true });

    await expect(pending).resolves.toEqual({ success: true });
  });

  it('无 success 字段的数据型响应不受影响，正常 resolve', async () => {
    const pending = ask.call('GET_LANGUAGE_LIST');

    const { requestId } = lastSent().payload;
    emitHostEvent('LANGUAGE_LIST', { requestId, current: 'zh-Hans', languages: ['zh-Hans'] });

    await expect(pending).resolves.toEqual({
      current: 'zh-Hans',
      languages: ['zh-Hans'],
    });
  });
});

describe('ask.call: 超时与通道缺失', () => {
  it('超时未收到响应时 reject，错误含 Timeout（timeoutMs 可配）', async () => {
    const pending = ask.call('GET_APP_INFO', undefined, { timeoutMs: 20 });

    let message = '';
    await pending.catch((err: Error) => {
      message = err instanceof Error ? err.message : String(err);
    });
    expect(message).toContain('Timeout');
  });

  it('超时后迟到相同 requestId 的响应不会 resolve 已失效的 promise', async () => {
    const pending = ask.call('GET_APP_INFO', undefined, { timeoutMs: 20 });
    const { requestId } = lastSent().payload;

    await pending.catch(() => {});
    // 迟到响应：pending 已被超时清除，应静默忽略而不是抛未处理错误
    emitHostEvent('SEND_APP_INFO', { requestId, appName: 'late' });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('dispatcher 订阅失败不锁死：通道恢复后下一次 call 重新订阅', async () => {
    const onHostEvent = g.__keel_onHostEvent;
    delete g.__keel_onHostEvent;
    try {
      // 通道缺失：请求仍会发出（emit 通道独立），但响应无人回发，本次按超时失败
      const first = ask.call('CLOSE_EXTENSION', undefined, { timeoutMs: 50 });
      await first.catch(() => {});
    } finally {
      // finally 恢复：用例任何路径（含超时中断）都不能把通道泄漏给后续用例
      g.__keel_onHostEvent = onHostEvent;
    }

    // 通道恢复：同响应事件再次 call，应重新订阅并完成请求-响应往返
    const pending = ask.call('CLOSE_EXTENSION');
    const { requestId } = lastSent().payload;
    emitHostEvent('CLOSE_EXTENSION_RESULT', { requestId, success: true });
    await expect(pending).resolves.toMatchObject({ success: true });
  });

  it('通道缺失时（不在 keel 沙箱内）立即 reject', async () => {
    const emit = g.__keel_emitEvent;
    delete g.__keel_emitEvent;

    let message = '';
    await ask.call('GET_APP_INFO').catch((err: Error) => {
      message = err instanceof Error ? err.message : String(err);
    });
    expect(message).toContain('__keel_emitEvent');

    g.__keel_emitEvent = emit;
  });
});

describe('ask.send: 单向通知', () => {
  it('按契约发出事件与载荷', () => {
    ask.send('GUEST_SLEEP_STATE', { sleeping: true, reason: 'hidden' });

    expect(lastSent()).toEqual({
      event: 'GUEST_SLEEP_STATE',
      payload: { sleeping: true, reason: 'hidden' },
    });
  });

  it('通道缺失时不抛错（warn 并丢弃）', () => {
    const emit = g.__keel_emitEvent;
    delete g.__keel_emitEvent;

    expect(() => ask.send('GUEST_SLEEP_STATE', { sleeping: false })).not.toThrow();
    expect(sentEvents).toHaveLength(0);

    g.__keel_emitEvent = emit;
  });
});

describe('ask.on: 订阅宿主推送', () => {
  it('收到宿主推送并拿到载荷', () => {
    let seen: { visible?: boolean } | null = null;
    ask.on('HOST_VISIBILITY', (payload) => {
      seen = payload;
    });

    emitHostEvent('HOST_VISIBILITY', { visible: false });
    expect((seen as { visible?: boolean } | null)?.visible).toBe(false);
  });

  it('返回的取消函数生效', () => {
    let count = 0;
    const off = ask.on('HOST_VISIBILITY', () => {
      count += 1;
    });

    emitHostEvent('HOST_VISIBILITY', { visible: true });
    off();
    emitHostEvent('HOST_VISIBILITY', { visible: true });
    expect(count).toBe(1);
  });

  it('通道缺失时返回 no-op 且不抛错', () => {
    const onHostEvent = g.__keel_onHostEvent;
    delete g.__keel_onHostEvent;

    const off = ask.on('HOST_VISIBILITY', () => {});
    expect(() => off()).not.toThrow();

    g.__keel_onHostEvent = onHostEvent;
  });
});

describe('http: 基于 ask.call 的特化层', () => {
  it('get(url) 发出 HTTP_REQUEST（method GET + 自动 requestId）并 resolve data', async () => {
    const pending = http.get<{ title: string }>('https://api.example.com/items');

    const sent = lastSent();
    expect(sent.event).toBe('HTTP_REQUEST');
    expect(sent.payload.url).toBe('https://api.example.com/items');
    expect(sent.payload.method).toBe('GET');
    expect(sent.payload.requestId).toMatch(/^HTTP_REQUEST-\d+$/);

    const { requestId } = sent.payload;
    emitHostEvent('HTTP_RESPONSE', {
      requestId,
      success: true,
      status: 200,
      data: { title: 'ok' },
    });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ title: 'ok' });
  });

  it('post(url, body) 携带 method/body', async () => {
    const pending = http.post('https://api.example.com/items', { a: 1 });

    const sent = lastSent();
    expect(sent.payload.method).toBe('POST');
    expect(sent.payload.body).toEqual({ a: 1 });

    const { requestId } = sent.payload;
    emitHostEvent('HTTP_RESPONSE', { requestId, success: true, status: 201, data: null });
    await expect(pending).resolves.toMatchObject({ status: 201 });
  });

  it('HTTP 失败（success:false）走 reject，且 AskError.response 保留 status/data', async () => {
    const pending = http.get('https://api.example.com/404');

    const { requestId } = lastSent().payload;
    emitHostEvent('HTTP_RESPONSE', {
      requestId,
      success: false,
      status: 404,
      data: { message: 'Not Found' },
    });

    let caught: unknown;
    await pending.catch((err: unknown) => {
      caught = err;
    });
    expect(caught instanceof AskError).toBe(true);
    const err = caught as AskError;
    expect(err.message).toContain('failed');
    // HTTP_RESPONSE 契约无 error 字段：状态码与响应体从 response 原文恢复
    expect((err.response as { status?: number }).status).toBe(404);
    expect((err.response as { data?: unknown }).data).toEqual({ message: 'Not Found' });
  });
});

describe('契约生成物：配对表与注释 key', () => {
  it('EVENT_PAIRS 覆盖全部请求-响应事件对', () => {
    expect(EVENT_PAIRS).toEqual({
      CLEAR_CHAT_HISTORY: 'CLEAR_CHAT_HISTORY_RESULT',
      CLOSE_EXTENSION: 'CLOSE_EXTENSION_RESULT',
      GET_APP_INFO: 'SEND_APP_INFO',
      GET_LANGUAGE_LIST: 'LANGUAGE_LIST',
      HTTP_REQUEST: 'HTTP_RESPONSE',
      SEND_EMAIL: 'SEND_EMAIL_RESULT',
      SET_APP_LANGUAGE: 'SET_APP_LANGUAGE_RESULT',
      SET_TOOLBOX_ENTRIES: 'SET_TOOLBOX_ENTRIES_RESULT',
      SPEECH_REQUEST: 'SPEECH_RESPONSE',
    });
  });

  it('注释分组 key 不进入事件名列表', () => {
    expect(GUEST_TO_HOST_EVENT_NAMES).not.toContain('// --- 系统内置 ---');
    expect(GUEST_TO_HOST_EVENT_NAMES).not.toContain('// --- 标准原生能力 ---');
    expect(HOST_TO_GUEST_EVENT_NAMES).not.toContain('// --- 系统内置 ---');
    expect(HOST_TO_GUEST_EVENT_NAMES).not.toContain('// --- 标准原生能力 ---');
  });
});
