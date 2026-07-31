import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const footerCode = readFileSync(join(import.meta.dir, 'askc-footer.js'), 'utf8');

function runFooter() {
  new Function(footerCode)();
}

type Opts = {
  sendBatch?: boolean;
  keel?: boolean;
  react?: boolean;
  reconciler?: boolean;
  guest?: unknown;
};

type Spy = {
  fn: (...args: unknown[]) => void;
  calls: unknown[][];
};

function createSpy(): Spy {
  const calls: unknown[][] = [];
  return {
    fn: (...args: unknown[]) => {
      calls.push(args);
    },
    calls,
  };
}

function setupGlobals(opts: Opts = {}): Spy {
  const render = createSpy();
  if (opts.sendBatch !== false) {
    (globalThis as unknown as { __keel_sendBatch: unknown }).__keel_sendBatch = () => {};
  }
  if (opts.keel !== false) {
    (globalThis as unknown as { __keel: unknown }).__keel = {
      guest: opts.guest ?? { default: () => null },
    };
  }
  if (opts.react !== false) {
    (globalThis as unknown as { React: unknown }).React = {
      createElement: () => ({ type: 'el' }),
    };
  }
  if (opts.reconciler !== false) {
    (globalThis as unknown as { KeelReconciler: unknown }).KeelReconciler = { render: render.fn };
  }
  return render;
}

function clearGlobals() {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g['__keel_sendBatch'];
  delete g['__keel'];
  delete g['KeelReconciler'];
  delete g['React'];
}

describe('askc-footer auto-render', () => {
  afterEach(clearGlobals);

  it('完整全局时调用 render', () => {
    const render = setupGlobals();
    runFooter();
    expect(render.calls).toHaveLength(1);
  });

  it('缺 __keel_sendBatch 不渲染', () => {
    const render = setupGlobals({ sendBatch: false });
    runFooter();
    expect(render.calls).toHaveLength(0);
  });

  it('缺 __keel.guest 不渲染', () => {
    const render = setupGlobals({ keel: false });
    runFooter();
    expect(render.calls).toHaveLength(0);
  });

  it('缺 React 不渲染', () => {
    const render = setupGlobals({ react: false });
    runFooter();
    expect(render.calls).toHaveLength(0);
  });

  it('缺 KeelReconciler 不渲染', () => {
    const render = setupGlobals({ reconciler: false });
    runFooter();
    expect(render.calls).toHaveLength(0);
  });

  it('usePanels hook 模式触发渲染', () => {
    const render = setupGlobals({
      guest: { usePanels: () => ({ left: 'L', right: 'R' }) },
    });
    runFooter();
    expect(render.calls).toHaveLength(1);
  });

  it('guest 无有效组件不渲染', () => {
    const render = setupGlobals({ guest: {} });
    runFooter();
    expect(render.calls).toHaveLength(0);
  });

  it('render 入参用 __keel_sendBatch', () => {
    const sendBatch = () => {};
    (globalThis as unknown as { __keel_sendBatch: unknown }).__keel_sendBatch = sendBatch;
    (globalThis as unknown as { __keel: unknown }).__keel = { guest: { default: () => null } };
    (globalThis as unknown as { React: unknown }).React = {
      createElement: () => ({ type: 'el' }),
    };
    const render = createSpy();
    (globalThis as unknown as { KeelReconciler: unknown }).KeelReconciler = { render: render.fn };
    runFooter();
    expect(render.calls[0]?.[1]).toBe(sendBatch);
  });
});
