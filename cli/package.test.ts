import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/**
 * cli/ 既是 CLI 源码目录，也是 npm 包的根目录。
 *
 * 这里守住发布配置：files 白名单漏掉一个文件时，本地开发与测试全都正常，
 * 只有用户安装后才会 `Cannot find module`，因此把这条约束提前到测试里。
 */
const cliDir = import.meta.dir;

const packageJson = JSON.parse(
  readFileSync(resolve(cliDir, 'package.json'), 'utf8')
) as {
  bin?: Record<string, string>;
  files?: string[];
};

const listedFiles = packageJson.files ?? [];
// bin 路径带 './' 前缀，files 白名单里不带。
const binEntryFiles = Object.values(packageJson.bin ?? {}).map((entry) =>
  entry.replace(/^\.\//, '')
);

// 只认相对路径引入：第三方包由安装时解析，不属于 files 白名单的职责。
const RELATIVE_IMPORT_PATTERN = /(?:import|from)\s*\(?\s*['"](\.[^'"]+)['"]/g;

/** 把 './x' 解析为真实文件；解析不到（例如第三方包）时返回 null。 */
function resolveSpecifierFile(
  specifier: string,
  importer: string
): string | null {
  const base = resolve(cliDir, dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? relative(cliDir, found) : null;
}

/** 递归收集入口文件的全部相对依赖（不含入口自身）。 */
function collectRelativeDependencies(entryFile: string): Set<string> {
  const visited = new Set<string>();
  const dependencies = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const importer = queue.shift() as string;
    if (visited.has(importer)) continue;
    visited.add(importer);

    const source = readFileSync(resolve(cliDir, importer), 'utf8');
    for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
      const dependency = resolveSpecifierFile(match[1] as string, importer);
      if (!dependency) continue;
      dependencies.add(dependency);
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }

  return dependencies;
}

describe('npm 包发布配置', () => {
  it('bin 入口存在且已加入 files 白名单', () => {
    expect(binEntryFiles.length).toBeGreaterThan(0);

    for (const entryFile of binEntryFiles) {
      expect(listedFiles).toContain(entryFile);
    }
  });

  it('files 白名单覆盖 bin 入口的全部相对依赖', () => {
    const missing: string[] = [];

    for (const entryFile of binEntryFiles) {
      for (const dependency of collectRelativeDependencies(entryFile)) {
        if (!listedFiles.includes(dependency)) missing.push(dependency);
      }
    }

    expect(missing).toEqual([]);
  });

  it('files 白名单里的文件真实存在', () => {
    const missing = listedFiles.filter(
      (file) => !existsSync(resolve(cliDir, file))
    );

    expect(missing).toEqual([]);
  });
});
