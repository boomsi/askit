import { EventHandler } from './EventHandler.host';

type Msg = { event: string; payload?: unknown };

function createMockEngine() {
  let msgCallback: ((msg: Msg) => void) | null = null;
  const sent: { event: string; payload: unknown }[] = [];
  return {
    engine: {
      sendEvent: (event: string, payload: unknown) => sent.push({ event, payload }),
      on: (event: string, cb: (msg: Msg) => void) => {
        if (event === 'message') msgCallback = cb;
        return () => {
          msgCallback = null;
        };
      },
    },
    get msg() {
      return msgCallback;
    },
    sent,
  };
}

describe('EventHandler.host', () => {
  it('GET_APP_INFO 占位 handler 返回 SEND_APP_INFO', async () => {
    const mock = createMockEngine();
    EventHandler.setup(mock.engine as never, { tabId: 't1' });
    await mock.msg!({ event: 'GET_APP_INFO', payload: { requestId: 'r1' } });
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]?.event).toBe('SEND_APP_INFO');
    const payload = mock.sent[0]?.payload as { requestId: string; appName: string };
    expect(payload.requestId).toBe('r1');
    expect(payload.appName).toBe('');
  });

  it('未知事件不 sendEvent', async () => {
    const mock = createMockEngine();
    EventHandler.setup(mock.engine as never, { tabId: 't1' });
    await mock.msg!({ event: 'UNKNOWN_EVENT', payload: {} });
    expect(mock.sent).toHaveLength(0);
  });

  it('原型链属性（toString 等）不被误当已注册事件', async () => {
    const mock = createMockEngine();
    EventHandler.setup(mock.engine as never, { tabId: 't1' });
    // in 检查会命中 Object.prototype 继承属性，hasOwn 不会
    await mock.msg!({ event: 'toString', payload: {} });
    await mock.msg!({ event: 'constructor', payload: {} });
    expect(mock.sent).toHaveLength(0);
  });

  it('customHandler 覆盖默认 GET_APP_INFO', async () => {
    const mock = createMockEngine();
    EventHandler.setup(mock.engine as never, {
      tabId: 't1',
      handlers: {
        GET_APP_INFO: async () => ({
          requestId: 'r1',
          appName: 'Custom',
          logo: '',
          languageContents: null,
          favoriteCount: 0,
          usedCount: 0,
          author: '',
        }),
      },
    });
    await mock.msg!({ event: 'GET_APP_INFO', payload: { requestId: 'r1' } });
    expect(mock.sent).toHaveLength(1);
    const sent = mock.sent[0] as { payload: { appName: string } };
    expect(sent.payload.appName).toBe('Custom');
  });

  it('无 tabId 时 setup 返回 no-op', () => {
    const mock = createMockEngine();
    const unsub = EventHandler.setup(mock.engine as never, { tabId: '' });
    expect(typeof unsub).toBe('function');
    expect(mock.sent).toHaveLength(0);
  });

  it('onLog 记录双向日志', async () => {
    const mock = createMockEngine();
    const logs: Array<{ dir: string; event: string }> = [];
    EventHandler.setup(mock.engine as never, {
      tabId: 't1',
      onLog: (dir, event) => logs.push({ dir, event }),
    });
    await mock.msg!({ event: 'GET_APP_INFO', payload: { requestId: 'r1' } });
    expect(logs.some((l) => l.dir === 'guestToHost' && l.event === 'GET_APP_INFO')).toBe(true);
    expect(logs.some((l) => l.dir === 'hostToGuest' && l.event === 'SEND_APP_INFO')).toBe(true);
  });

  it('handler 抛错被捕获不中断', async () => {
    const mock = createMockEngine();
    EventHandler.setup(mock.engine as never, {
      tabId: 't1',
      handlers: {
        GET_APP_INFO: async () => {
          throw new Error('boom');
        },
      },
    });
    await mock.msg!({ event: 'GET_APP_INFO', payload: { requestId: 'r1' } });
    expect(mock.sent).toHaveLength(0);
  });
});
