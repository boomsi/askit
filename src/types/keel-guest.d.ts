/**
 * keel/guest 的最小类型 stub
 *
 * 用途：仅给 askit 的 tsc typecheck 提供类型，避免 TS 跟随 import 扫描真实 keel 源码
 * （keel 源码自身在 askit 严格 tsconfig 下有类型错误，且 `import 'react'` 在 CI 的
 *  `../keel` 路径下无法解析到 askit 的 node_modules）。
 *
 * 通过 tsconfig `paths` 把 'keel/guest' 指向本文件。
 *
 * 运行时：bun 默认会读 tsconfig `paths`，但 askit 自身测试不调用这两个 hook
 * （仅 host 端测试，EventHandler.guest.ts 的 hook 由下游消费者在 React 组件内调用）。
 * 下游消费 askit 时，由下游自己的 bundler 解析真实 keel/guest，不受 askit tsconfig 影响。
 */
declare module 'keel/guest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function useSendToHost(): (event: string, payload: unknown) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function useHostEvent<T = unknown>(event: string, handler: (payload: T) => void): void;
}
