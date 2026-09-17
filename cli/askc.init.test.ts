import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdInit, validateManifest } from './askc';

/** 每个用例一个独立临时目录，避免相互污染。 */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'askc-init-'));
}

describe('cmdInit', () => {
  it('生成工程骨架：manifest / package.json / 入口 / README + src、dist', async () => {
    const dir = makeTempDir();
    try {
      await cmdInit([dir], new Map([['name', 'GasApp']]));

      for (const file of [
        'manifest.json',
        'package.json',
        'README.md',
        join('src', 'unified-app.tsx'),
      ]) {
        expect(existsSync(join(dir, file))).toBe(true);
      }
      expect(existsSync(join(dir, 'dist'))).toBe(true);

      const manifest = JSON.parse(
        readFileSync(join(dir, 'manifest.json'), 'utf8')
      );
      // unified 单 bundle 模式：不声明面板文件，
      // 否则 build 校验会因 menu.js / ext.js 不存在而失败。
      expect(manifest.layout.unified).toBe('unified-app.js');
      expect(manifest.layout.leftPanel).toBeUndefined();
      expect(manifest.layout.rightPanel).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('build 只产出 app.js，build:askc 才打 .askc', async () => {
    const dir = makeTempDir();
    try {
      await cmdInit([dir], new Map([['name', 'GasApp']]));
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

      // build 走 keel bundler，产出中间产物 app.js。
      expect(pkg.scripts.build).toContain('keel/src/cli/bin.ts');
      expect(pkg.scripts.build).toContain('-o app.js');

      // build:askc 复用 CLI 的 build 子命令；若它回头再调 build:askc 就会递归。
      expect(pkg.scripts['build:askc']).toContain('askit/cli/askc.ts build');
      expect(pkg.scripts['build:askc']).not.toContain('build:askc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('依赖包含构建所需的 askit / keel / react', async () => {
    const dir = makeTempDir();
    try {
      await cmdInit([dir], new Map([['name', 'GasApp']]));
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

      expect(Object.keys(pkg.dependencies).sort()).toEqual([
        'askit',
        'keel',
        'react',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('package.json 的 name 转小写（npm 包名不允许大写）', async () => {
    const dir = makeTempDir();
    try {
      await cmdInit([dir], new Map([['name', 'GasApp']]));
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

      expect(pkg.name).toBe('gasapp');
      // manifest 里的应用名保持调用方传入的大小写。
      expect(manifest.name).toBe('GasApp');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('默认应用名生成的 manifest 能通过 CLI 自身校验', async () => {
    const dir = makeTempDir();
    try {
      // 不带 --name 走默认名：默认名必须合法，否则 init 出来的工程
      // 会被 build 的命名校验直接拒绝（默认名曾用连字符踩过这个坑）。
      await cmdInit([dir], new Map());

      const manifest = JSON.parse(
        readFileSync(join(dir, 'manifest.json'), 'utf8')
      );
      expect(() => validateManifest(manifest, null)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非法 --name 在 init 阶段即报错', async () => {
    const dir = makeTempDir();
    try {
      await expect(
        cmdInit([dir], new Map([['name', 'my-app']]))
      ).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('create-* 包约定', () => {
  it('首个参数是目录时按 init 处理（bun create askc-app my-app）', () => {
    const parent = makeTempDir();
    const dir = join(parent, 'gasapp');
    try {
      const proc = Bun.spawnSync(
        ['bun', 'run', join(import.meta.dir, 'askc.ts'), dir, '--name', 'GasApp'],
        { stdout: 'pipe', stderr: 'pipe' }
      );

      expect(proc.exitCode).toBe(0);
      expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
