/* eslint-disable no-console */

import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';

import {
  validateDescription,
  validateJsPathMaybe,
  validateName,
  validateSemver,
} from './manifest.validate';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

type Manifest = {
  /** App unique name (PascalCase recommended) */
  name: string;
  /** Semver (x.y.z) */
  version: string;
  /** Human readable description */
  description: string;
  /** Optional author/team */
  author?: string;

  contract?: {
    name: string;
    version: number;
  };

  /** Permission declarations (reserved for future host enforcement) */
  permissions?: string[];

  integrity?: {
    algorithm: 'sha256';
    files: Record<string, string>;
  };

  /** Layout configuration (Canvas spec) */
  layout?: {
    leftPanel?: string;
    rightPanel?: string;
    rightPanelDefaultVisible?: boolean;

    /**
     * Internal build artifact name used by askc/keel host.
     * Defaults to 'unified-app.js' when omitted.
     */
    unified?: string;
  };
};

type SpawnOptions = {
  cwd?: string;
  stdout?: 'inherit' | 'pipe';
  stderr?: 'inherit' | 'pipe';
};

type Subprocess = {
  exited: Promise<number>;
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  kill?: (signal?: string) => void;
};

declare const Bun: {
  file: (path: string) => { text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> };
  write: (path: string, data: string) => Promise<void>;
  spawn: (cmd: string[], opts?: SpawnOptions) => Subprocess;
  serve: (opts: { port: number; fetch: (req: Request) => Response | Promise<Response> }) => {
    port: number;
    stop: (closeAll?: boolean) => void;
  };
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const DEFAULT_CONTRACT = { name: 'ask', version: 1 } as const;

export function validateManifest(manifest: Manifest, projectRoot: string | null): void {
  validateName(manifest.name);
  validateSemver(manifest.version);
  validateDescription(manifest.description);

  validateJsPathMaybe(manifest.layout?.leftPanel, 'layout.leftPanel');
  validateJsPathMaybe(manifest.layout?.rightPanel, 'layout.rightPanel');

  // If building locally, ensure declared panel scripts exist when provided.
  if (projectRoot) {
    const root = projectRoot;
    const checkFileExists = async (rel: string): Promise<boolean> => {
      try {
        const st = await stat(joinPath(root, rel));
        return st.isFile();
      } catch {
        return false;
      }
    };

    void (async () => {
      if (manifest.layout?.leftPanel) {
        const ok = await checkFileExists(manifest.layout.leftPanel);
        if (!ok) throw new Error(`layout.leftPanel file not found: ${manifest.layout.leftPanel}`);
      }
      if (manifest.layout?.rightPanel) {
        const ok = await checkFileExists(manifest.layout.rightPanel);
        if (!ok) throw new Error(`layout.rightPanel file not found: ${manifest.layout.rightPanel}`);
      }
    })();
  }
}

function toHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = '';
  for (const b of view) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Utf8(text: string): Promise<string> {
  const bytes = textEncoder.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
}

async function run(cmd: string[], opts?: SpawnOptions): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', ...opts });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`命令执行失败 (${code}): ${cmd.join(' ')}`);
  }
}

async function runCapture(cmd: string[], opts?: SpawnOptions): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', ...opts });
  const [code, out, err] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).arrayBuffer() : Promise.resolve(new ArrayBuffer(0)),
    proc.stderr ? new Response(proc.stderr).arrayBuffer() : Promise.resolve(new ArrayBuffer(0)),
  ]);
  if (code !== 0) {
    const errText = textDecoder.decode(err);
    throw new Error(`命令执行失败 (${code}): ${cmd.join(' ')}\n${errText}`);
  }
  return textDecoder.decode(out);
}

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string | boolean> } {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    i++;
  }

  return { positional, flags };
}

function getFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const v = flags.get(key);
  return typeof v === 'string' ? v : null;
}

function hasFlag(flags: Map<string, string | boolean>, key: string): boolean {
  return flags.get(key) === true;
}

async function readJson<T>(path: string): Promise<T> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as T;
}

function printHelp(): void {
  console.log(`
askc-cli（最小闭环）

用法：
  askc init <dir> [--name <appName>]
  askc build [--project <dir>] [--out <file>]
  askc verify <file.askc>
  askc dev [--project <dir>] [--out <file>] [--debounce <ms>] [--watch-manifest]
          [--phase2] [--host-project <dir>] [--metro] [--log-server] [--log-port <port>]

说明：
  - 默认入口：src/unified-app.tsx
  - 默认输出：dist/unified-app.js + <name>.askc
  - build 会写入 manifest.contract / manifest.integrity（sha256）
  - Guest bundle 运行在 Keel QuickJS 沙箱，外部依赖建议 external：react/react-native/react/jsx-runtime/keel/*
`);
}

async function cmdInit(args: string[], flags: Map<string, string | boolean>): Promise<void> {
  const dir = args[0];
  if (!dir) throw new Error('缺少 <dir>');

  const name = getFlag(flags, 'name') ?? 'my-askc-app';
  await run(['mkdir', '-p', joinPath(dir, 'src')]);
  await run(['mkdir', '-p', joinPath(dir, 'dist')]);

  const manifest: Manifest = {
    name,
    version: '0.1.0',
    description: 'Ask App (unified bundle)',
    contract: DEFAULT_CONTRACT,
    permissions: [],
    layout: {
      leftPanel: 'menu.js',
      rightPanel: 'ext.js',
      rightPanelDefaultVisible: false,
      unified: 'unified-app.js',
    },
  };

  await Bun.write(joinPath(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  await Bun.write(
    joinPath(dir, 'src', 'unified-app.tsx'),
    `import React from 'react';\n` +
      `import { View, Text } from 'react-native';\n` +
      `import { Panel } from 'askit';\n\n` +
      `export default function UnifiedApp() {\n` +
      `  return (\n` +
      `    <View style={{ flex: 1, padding: 16 }}>\n` +
      `      <Panel.Left>\n` +
      `        <View style={{ flex: 1 }}>\n` +
      `          <Text style={{ fontSize: 18, fontWeight: '600' }}>左侧面板</Text>\n` +
      `          <Text>这里可以放导航/工具列表</Text>\n` +
      `        </View>\n` +
      `      </Panel.Left>\n\n` +
      `      <Panel.Right>\n` +
      `        <View style={{ flex: 1 }}>\n` +
      `          <Text style={{ fontSize: 18, fontWeight: '600' }}>右侧面板</Text>\n` +
      `          <Text>这里可以放属性/详情/调试信息</Text>\n` +
      `        </View>\n` +
      `      </Panel.Right>\n` +
      `    </View>\n` +
      `  );\n` +
      `}\n`
  );

  await Bun.write(
    joinPath(dir, 'README.md'),
    `# ${name}\n\n` +
      `## 开发\n\n` +
      `- 生成 bundle：\`askc build --project .\`\n` +
      `- 校验包：\`askc verify ./${name}.askc\`\n`
  );

  console.log(`✅ 已初始化：${dir}`);
  console.log(`- 下一步：cd ${dir} && askc build --project .`);
}

function buildAutoRenderFooter(): string {
  return `
;(function(){
  if(typeof __sendToHost!=="function"||typeof __KeelGuest==="undefined") return;
  try{
    var React=globalThis.React;
    if(!React){console.error("[keel] React not found, cannot auto-render");return;}
    var KeelLet=globalThis.KeelLet;
    if(!KeelLet||!KeelLet.render){console.error("[keel] KeelLet not found, cannot auto-render");return;}
    var Comp=typeof __KeelGuest==="function"?__KeelGuest:(__KeelGuest.default||__KeelGuest);
    if(!Comp||typeof Comp!=="function"){console.warn("[keel] No valid component found in guest");return;}
    var el=React.createElement(Comp);
    console.log("[keel] Auto-rendering guest component");
    KeelLet.render(el,__sendToHost);
  }catch(e){console.error("[keel] Auto-render failed:",e);}
})();`;
}

/**
 * External modules and their global variable names
 * In JSC sandbox, these are provided as globalThis.React, etc.
 */
const EXTERNALS_MAP: Record<string, string> = {
  react: 'React',
  'react/jsx-runtime': 'ReactJSXRuntime',
  'react/jsx-dev-runtime': 'ReactJSXDevRuntime',
  'react-native': 'ReactNative',
  '@keel/let': 'KeelLet',
};

async function cmdBuild(args: string[], flags: Map<string, string | boolean>): Promise<void> {
  const project = getFlag(flags, 'project') ?? process.cwd();
  const out = getFlag(flags, 'out');

  const manifestPath = joinPath(project, 'manifest.json');
  const manifest = await readJson<Manifest>(manifestPath);
  validateManifest(manifest, project);
  if (!manifest.contract) manifest.contract = DEFAULT_CONTRACT;
  const unifiedName = manifest.layout?.unified ?? 'unified-app.js';

  // 1. 触发项目内部构建（例如执行 keel cli 生成 app.js）
  await run(['npm', 'run', 'build'], { cwd: project });

  const distDir = joinPath(project, 'dist');
  await mkdir(distDir, { recursive: true });

  // 2. 将内部构建生成的 app.js 作为统一下发的文件
  const appJsPath = joinPath(project, 'app.js');
  const finalOut = joinPath(distDir, unifiedName);

  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(appJsPath);
  } catch {
    throw new Error(`构建失败：未找到生成的 app.js 文件。\n请确保 package.json 的 build 脚本生成了根目录下的 app.js`);
  }
  if (!st.isFile()) {
    throw new Error(`构建失败：${appJsPath} 不是文件`);
  }

  const appJsRaw = await Bun.file(appJsPath).text();
  await Bun.write(finalOut, appJsRaw);

  // 2.5 将构建产物中的图片等非 JS 资产拷贝到 dist/（不删根目录源图片，避免误删源文件）
  const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
  const projectFiles = await readdir(project);
  let assetCount = 0;
  for (const file of projectFiles) {
    const dotIdx = file.lastIndexOf('.');
    if (dotIdx === -1) continue;
    const ext = file.substring(dotIdx).toLowerCase();
    if (!assetExts.includes(ext)) continue;
    const srcPath = joinPath(project, file);
    const fileSt = await stat(srcPath);
    if (!fileSt.isFile()) continue;
    await run(['cp', srcPath, joinPath(distDir, file)]);
    assetCount++;
  }
  if (assetCount > 0) {
    console.log(`- assets: ${assetCount} 个资源文件已拷贝到 dist/`);
  }

  // 3. 写入完整性信息（sha256），用于 verify/宿主校验
  const digest = await sha256Utf8(appJsRaw);
  const integrityKey = `dist/${unifiedName}`;
  const prevIntegrity = manifest.integrity?.files ?? {};
  manifest.integrity = {
    algorithm: 'sha256',
    files: { ...prevIntegrity, [integrityKey]: digest },
  };
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // 4. 打包文件为 .askc
  const outFile = out ?? joinPath(project, `${manifest.name}.askc`);
  await rm(outFile, { force: true });
  // 依赖系统 zip 命令（unix）；Windows 需另装 zip 或改用跨平台 zip 库
  await run(['zip', '-r', '-X', outFile, 'manifest.json', 'dist'], { cwd: project });

  // 5. 清理中间产物：app.js、dist/ 目录
  await rm(appJsPath, { force: true });
  await rm(distDir, { recursive: true, force: true });

  console.log('✅ build 完成 (基于项目内部 app.js 构建)');
  console.log(`- bundle: ${finalOut}`);
  console.log(`- package: ${outFile}`);
}

async function cmdVerify(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) throw new Error('缺少 <file.askc>');

  const manifestText = await runCapture(['unzip', '-p', filePath, 'manifest.json']);
  const manifest = JSON.parse(manifestText) as Manifest;
  // verify should validate manifest structure as well
  validateManifest(manifest, null);
  const unifiedName = manifest.layout?.unified ?? null;
  if (!unifiedName) throw new Error('manifest.json 缺少 layout.unified');

  const listing = await runCapture(['unzip', '-l', filePath]);
  const expected = `dist/${unifiedName}`;
  if (!listing.includes(expected)) {
    throw new Error(`包内缺少 ${expected}`);
  }

  const contract = manifest.contract ?? null;
  const contractOk =
    contract === null
      ? null
      : contract.name === DEFAULT_CONTRACT.name && contract.version <= DEFAULT_CONTRACT.version;

  // 校验 sha256（若 manifest 未提供则提示）
  const expectedHash = manifest.integrity?.files?.[expected] ?? null;
  const bundledText = await runCapture(['unzip', '-p', filePath, expected]);
  const bundledHash = await sha256Utf8(bundledText);
  const hashOk = expectedHash ? expectedHash === bundledHash : null;

  console.log('✅ verify 报告');
  console.log(`- name: ${manifest.name}`);
  console.log(`- unified: ${expected}`);
  console.log(
    `- contract: ${contract ? `${contract.name}@v${contract.version}` : '（缺失）'}${
      contractOk === true ? ' ✅' : contractOk === false ? ' ❌' : ' ⚠️'
    }`
  );
  console.log(`- permissions: ${(manifest.permissions ?? []).join(', ') || '（无）'}`);
  console.log(`- integrity: sha256=${bundledHash}${hashOk === true ? ' ✅' : hashOk === false ? ' ❌' : ' ⚠️（manifest 未提供）'}`);

  if (contractOk === false) {
    throw new Error('contractVersion 不兼容（请升级宿主/工具链，或降低 contracts 版本）');
  }
  if (hashOk === false) {
    throw new Error('bundle sha256 与 manifest 不一致（包可能损坏或被篡改）');
  }
}

function parseDebounceMs(flags: Map<string, string | boolean>): number {
  const raw = getFlag(flags, 'debounce');
  if (!raw) return 300;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 300;
  return Math.floor(n);
}

async function listDirectories(root: string): Promise<string[]> {
  const dirs: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    dirs.push(dir);
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      const raw = await readdir(dir, { withFileTypes: true });
      entries = raw;
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('.')) continue;
      stack.push(joinPath(dir, ent.name));
    }
  }
  return dirs;
}

async function watchDirectoryTree(
  root: string,
  onEvent: (absPath: string) => void
): Promise<{ close: () => void }> {
  const watchers: FSWatcher[] = [];
  const watched = new Set<string>();

  const addWatcher = (dir: string) => {
    if (watched.has(dir)) return;
    watched.add(dir);
    try {
      const w = watch(
        dir,
        { persistent: true },
        (_eventType, filename) => {
          const name = typeof filename === 'string' ? filename : String(filename ?? '');
          const abs = name ? joinPath(dir, name) : dir;
          onEvent(abs);

          // 若新建了目录，尽力补上 watcher（best-effort）
          if (name) {
            void (async () => {
              try {
                const st = await stat(abs);
                if (st.isDirectory()) addWatcher(abs);
              } catch {
                // ignore
              }
            })();
          }
        }
      );
      watchers.push(w);
    } catch (err) {
      console.warn(`⚠️  watch 失败：${dir} (${String((err as Error)?.message ?? err)})`);
    }
  };

  const dirs = await listDirectories(root);
  dirs.forEach(addWatcher);

  return {
    close: () => {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

async function cmdDev(args: string[], flags: Map<string, string | boolean>): Promise<void> {
  const project = getFlag(flags, 'project') ?? process.cwd();
  const out = getFlag(flags, 'out');
  const debounceMs = parseDebounceMs(flags);
  const watchManifest = hasFlag(flags, 'watch-manifest');
  const phase2 = hasFlag(flags, 'phase2');
  const enableMetro = phase2 || hasFlag(flags, 'metro');
  const enableLogServer = phase2 || hasFlag(flags, 'log-server');
  const hostProject = getFlag(flags, 'host-project');
  const logPortRaw = getFlag(flags, 'log-port');
  const logPort = (() => {
    if (!logPortRaw) return 9999;
    const n = Number(logPortRaw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 9999;
  })();

  const srcRoot = joinPath(project, 'src');
  const manifestPath = joinPath(project, 'manifest.json');

  console.log(`🟢 askc dev（${phase2 ? 'Phase 2' : 'Phase 1'}）`);
  console.log(`- project: ${project}`);
  console.log(`- watch: ${srcRoot}${watchManifest ? ` + ${manifestPath}` : ''}`);
  console.log(`- debounce: ${debounceMs}ms`);
  if (enableLogServer) console.log(`- log-server: http://localhost:${logPort}/log`);
  if (enableMetro) console.log(`- metro: ${hostProject ?? '（缺少 --host-project）'} -> http://localhost:8081`);
  console.log('- 退出：Ctrl+C');

  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let queued = false;
  let lastManifestWriteAt = 0;

  let stopLogServer: (() => void) | null = null;
  let metroProc: Subprocess | null = null;

  const startLogServer = (): void => {
    if (!enableLogServer) return;
    const COLORS = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
    } as const;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    const server = Bun.serve({
      port: logPort,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors });
        if (req.method === 'POST' && url.pathname === '/log') {
          const body = await req.text();
          try {
            const data = JSON.parse(body) as { level?: string; msg?: string };
            const level = data.level || 'log';
            const msg = data.msg || '';
            const time = new Date().toLocaleTimeString();
            let color: string = COLORS.green;
            let prefix = '📱';
            if (level === 'error') {
              color = COLORS.red;
              prefix = '❌';
            } else if (level === 'warn') {
              color = COLORS.yellow;
              prefix = '⚠️ ';
            } else if (level === 'info') {
              color = COLORS.cyan;
              prefix = 'ℹ️ ';
            }
            // 非 error 的超长消息截断到 1400 字符，避免日志刷屏
            if (level !== 'error' && msg.length > 1400) {
              console.log(`${color}[${time}] ${prefix} [truncated] ${msg.slice(0, 1400)}${COLORS.reset}`);
            } else {
              console.log(`${color}[${time}] ${prefix} ${msg}${COLORS.reset}`);
            }
          } catch {
            console.log(`[RAW] ${body}`);
          }
          return new Response('ok', { status: 200, headers: cors });
        }
        if (req.method === 'GET' && url.pathname === '/') {
          return new Response('Log server running. POST to /log with { level, msg }', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors },
          });
        }
        return new Response('Not found', { status: 404, headers: cors });
      },
    });

    console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
    console.log(`${COLORS.green}  📡 askc log server 启动成功${COLORS.reset}`);
    console.log(`${COLORS.cyan}  监听端口: ${server.port}${COLORS.reset}`);
    console.log(`${COLORS.yellow}  JS 日志将在下方实时显示...${COLORS.reset}`);
    console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}\n`);

    stopLogServer = () => server.stop(true);
  };

  const startMetro = (): void => {
    if (!enableMetro) return;
    if (!hostProject) {
      console.warn('⚠️  未提供 --host-project，跳过启动 Metro（可自行在宿主工程中运行 react-native start）');
      return;
    }
    console.log(`\n🚇 启动 Metro: ${hostProject}`);
    const rnBin = joinPath(hostProject, 'node_modules/.bin/react-native');
    metroProc = Bun.spawn(['node', rnBin, 'start', '--verbose', '--reset-cache'], {
      cwd: hostProject,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    metroProc.exited.then((code) => {
      if (code !== 0) console.error(`❌ Metro 退出（${code}）`);
    });
  };

  const buildOnce = async (reason: string) => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    queued = false;
    const startedAt = Date.now();
    console.log(`\n🔨 build (${reason})...`);
    try {
      await cmdBuild(args, new Map([...flags, ['project', project], ...(out ? [['out', out] as const] : [])]));
      lastManifestWriteAt = Date.now();
      console.log(`✅ dev build 完成（${Date.now() - startedAt}ms）`);
    } catch (err) {
      console.error(`❌ dev build 失败：${String((err as Error)?.message ?? err)}`);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        void buildOnce('coalesced');
      }
    }
  };

  const schedule = (absPath: string) => {
    // 避免因 build 写 manifest 自触发（仅在 watchManifest 时生效）
    if (watchManifest && absPath.endsWith('manifest.json')) {
      if (Date.now() - lastManifestWriteAt < 800) return;
    }
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void buildOnce(absPath);
    }, debounceMs);
  };

  await buildOnce('initial');
  startLogServer();
  startMetro();

  const watcher = await watchDirectoryTree(srcRoot, schedule);
  const manifestWatcher = watchManifest
    ? watch(
        manifestPath,
        { persistent: true },
        () => schedule(manifestPath)
      )
    : null;

  const cleanup = () => {
    watcher.close();
    try {
      manifestWatcher?.close();
    } catch {
      // ignore
    }
    try {
      stopLogServer?.();
    } catch {
      // ignore
    }
    try {
      metroProc?.kill?.('SIGINT');
    } catch {
      // ignore
    }
  };

  const proc = process as unknown as {
    on?: (event: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
    exit: (code?: number | undefined) => never;
  };
  proc.on?.('SIGINT', () => {
    cleanup();
    proc.exit(0);
  });
  proc.on?.('SIGTERM', () => {
    cleanup();
    proc.exit(0);
  });

  // keep alive
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  await new Promise<void>(() => {});
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === '-h' || cmd === '--help') {
    printHelp();
    return;
  }

  const { positional, flags } = parseFlags(argv.slice(1));

  switch (cmd) {
    case 'init':
      await cmdInit(positional, flags);
      return;
    case 'build':
      await cmdBuild(positional, flags);
      return;
    case 'verify':
      await cmdVerify(positional);
      return;
    case 'dev':
      await cmdDev(positional, flags);
      return;
    default:
      printHelp();
      throw new Error(`未知命令: ${cmd}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exit(1);
  });
}
