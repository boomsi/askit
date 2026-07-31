/**
 * Throttle and Debounce Tests
 *
 * 使用 bun:test + 轻量假时钟实现。bun:test 无 vitest 的 useFakeTimers /
 * advanceTimersByTime，故在此手写 mock：throttle/debounce 仅依赖
 * setTimeout / clearTimeout / Date.now，全部替换为可控实现。
 *
 * 注意：初始 currentTime 设为一个足够大的值（START_TIME），使 throttle
 * 首次调用（内部 lastCall 初值为 0）的 timeSinceLastCall >= delay，从而
 * 立即执行——对齐 vitest useFakeTimers（其 Date.now() 初值为真实时间戳）。
 *
 * 断言用 fn.mock.calls + toHaveLength / toContainEqual：bun:test 的 expect
 * 类型未声明 jest 兼容的 toHaveBeenCalledTimes / toHaveBeenCalledWith
 * （运行时其实支持，但类型缺），改用原生支持的数组 matcher 更稳。
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { debounce, rateLimit, throttle } from './throttle';

// bun 的 mock() 类型声明为返回实现本身的类型（未带 .mock 属性），但运行时
// 会在函数上挂载 .mock.calls。这里用 Spy 类型补全 .mock 的类型声明，同时
// 让函数签名匹配 throttle/debounce/rateLimit 的 (...args: unknown[]) => unknown 约束。
type Spy = ((...args: unknown[]) => void) & {
  mock: { calls: unknown[][] };
};

const createSpy = (): Spy => mock(() => undefined) as unknown as Spy;

const START_TIME = 1_000_000;

let currentTime = 0;
let timerSeq = 1;
const pending = new Map<number, { cb: () => void; fireAt: number }>();
let realSetTimeout: typeof globalThis.setTimeout;
let realClearTimeout: typeof globalThis.clearTimeout;
let realDateNow: typeof Date.now;

function useFakeTimers() {
  currentTime = START_TIME;
  timerSeq = 1;
  pending.clear();
  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;
  realDateNow = Date.now;
  globalThis.setTimeout = ((cb: () => void, delay?: number) => {
    const id = timerSeq++;
    pending.set(id, { cb, fireAt: currentTime + (delay ?? 0) });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    if (id !== undefined) pending.delete(id);
  }) as unknown as typeof globalThis.clearTimeout;
  Date.now = () => currentTime;
}

function restoreRealTimers() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  Date.now = realDateNow;
}

function advanceTimersByTime(ms: number) {
  currentTime += ms;
  // 按到期时间升序触发，模拟真实事件循环顺序
  const due = [...pending.entries()]
    .filter(([, t]) => t.fireAt <= currentTime)
    .sort((a, b) => a[1].fireAt - b[1].fireAt);
  for (const [id, t] of due) {
    if (pending.has(id)) {
      pending.delete(id);
      t.cb();
    }
  }
}

describe('Throttle', () => {
  beforeEach(() => useFakeTimers());
  afterEach(() => restoreRealTimers());

  it('should execute immediately on first call', () => {
    const fn = createSpy();
    const throttled = throttle(fn, 100);
    throttled();
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('should throttle rapid calls', () => {
    const fn = createSpy();
    const throttled = throttle(fn, 100);
    throttled();
    throttled();
    throttled();
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('should execute after delay period', () => {
    const fn = createSpy();
    const throttled = throttle(fn, 100);
    throttled(); // t=START, executes immediately
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(50);
    throttled(); // schedules for t=START+100
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(50); // t=START+100
    expect(fn.mock.calls).toHaveLength(2);
  });

  it('should pass arguments correctly', () => {
    const fn = createSpy();
    const throttled = throttle(fn, 100);
    throttled('arg1', 'arg2', 123);
    expect(fn.mock.calls[fn.mock.calls.length - 1]).toEqual(['arg1', 'arg2', 123]);
  });

  it('should handle multiple throttle windows', () => {
    const fn = createSpy();
    const throttled = throttle(fn, 100);
    throttled(); // t=START
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(150); // t=START+150
    throttled(); // executes immediately (>100ms since last call)
    expect(fn.mock.calls).toHaveLength(2);
    advanceTimersByTime(150); // t=START+300
    throttled(); // executes immediately
    expect(fn.mock.calls).toHaveLength(3);
  });

  it('should clear pending timeout on new call within throttle period', () => {
    const fn = createSpy();
    const throttled = throttle(fn, 100);
    throttled(); // t=START, executes
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(50); // t=START+50
    throttled(); // schedules for t=START+100
    advanceTimersByTime(25); // t=START+75
    throttled(); // cancels previous, schedules for t=START+100 (75+25)
    advanceTimersByTime(25); // t=START+100
    expect(fn.mock.calls).toHaveLength(2);
  });
});

describe('Debounce', () => {
  beforeEach(() => useFakeTimers());
  afterEach(() => restoreRealTimers());

  it('should not execute immediately', () => {
    const fn = createSpy();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn.mock.calls).toHaveLength(0);
  });

  it('should execute after delay', () => {
    const fn = createSpy();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn.mock.calls).toHaveLength(0);
    advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('should reset timer on rapid calls', () => {
    const fn = createSpy();
    const debounced = debounce(fn, 100);
    debounced(); // t=START
    advanceTimersByTime(50); // t=START+50
    debounced(); // resets timer
    advanceTimersByTime(50); // t=START+100 (but timer was reset at START+50)
    expect(fn.mock.calls).toHaveLength(0);
    advanceTimersByTime(50); // t=START+150 (100ms since last call)
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('should pass arguments correctly', () => {
    const fn = createSpy();
    const debounced = debounce(fn, 100);
    debounced('arg1', 'arg2', 123);
    advanceTimersByTime(100);
    expect(fn.mock.calls[fn.mock.calls.length - 1]).toEqual(['arg1', 'arg2', 123]);
  });

  it('should use last call arguments', () => {
    const fn = createSpy();
    const debounced = debounce(fn, 100);
    debounced('first');
    advanceTimersByTime(50);
    debounced('second');
    advanceTimersByTime(50);
    debounced('third');
    advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[fn.mock.calls.length - 1]).toEqual(['third']);
  });

  it('should allow multiple execution windows', () => {
    const fn = createSpy();
    const debounced = debounce(fn, 100);
    debounced('first');
    advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(1);
    expect(fn.mock.calls[fn.mock.calls.length - 1]).toEqual(['first']);
    debounced('second');
    advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(2);
    expect(fn.mock.calls[fn.mock.calls.length - 1]).toEqual(['second']);
  });
});

describe('rateLimit', () => {
  beforeEach(() => useFakeTimers());
  afterEach(() => restoreRealTimers());

  it('should create throttled function when type is throttle', () => {
    const fn = createSpy();
    const limited = rateLimit(fn, { type: 'throttle', delay: 100 });
    limited();
    limited();
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(2);
  });

  it('should create debounced function when type is debounce', () => {
    const fn = createSpy();
    const limited = rateLimit(fn, { type: 'debounce', delay: 100 });
    limited();
    expect(fn.mock.calls).toHaveLength(0);
    advanceTimersByTime(100);
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('should return original function when type is none', () => {
    const fn = createSpy();
    const limited = rateLimit(fn, { type: 'none' });
    limited();
    limited();
    limited();
    expect(fn.mock.calls).toHaveLength(3);
  });

  it('should use default delay of 100ms', () => {
    const fn = createSpy();
    const limited = rateLimit(fn, { type: 'throttle' });
    limited();
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(99);
    limited();
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(1); // total 100ms
    expect(fn.mock.calls).toHaveLength(2);
  });

  it('should accept custom delay', () => {
    const fn = createSpy();
    const limited = rateLimit(fn, { type: 'throttle', delay: 200 });
    limited();
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(150);
    limited();
    expect(fn.mock.calls).toHaveLength(1);
    advanceTimersByTime(50); // total 200ms
    expect(fn.mock.calls).toHaveLength(2);
  });
});
