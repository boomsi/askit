import { describe, expect, it } from 'bun:test';

import { joinPath, sha256Utf8, validateManifest } from './askc';

describe('sha256Utf8', () => {
  it('空字符串', async () => {
    expect(await sha256Utf8('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('hello', async () => {
    expect(await sha256Utf8('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('相同输入相同输出', async () => {
    expect(await sha256Utf8('abc')).toBe(await sha256Utf8('abc'));
  });
});

describe('joinPath', () => {
  it('拼接多段', () => {
    expect(joinPath('a', 'b', 'c')).toBe('a/b/c');
  });
  it('过滤空段', () => {
    expect(joinPath('a', '', 'b')).toBe('a/b');
  });
  it('合并多余斜杠', () => {
    expect(joinPath('a/', '/b')).toBe('a/b');
  });
});

describe('validateManifest', () => {
  const valid = { name: 'TestApp', version: '1.0.0', description: 'desc' };
  it('合法 manifest 不抛', () => {
    expect(() => validateManifest(valid, null)).not.toThrow();
  });
  it('name 非字母开头抛错', () => {
    expect(() => validateManifest({ ...valid, name: '1test' }, null)).toThrow();
  });
  it('name 含非法字符抛错', () => {
    expect(() => validateManifest({ ...valid, name: 'test-app' }, null)).toThrow();
  });
  it('version 非 semver 抛错', () => {
    expect(() => validateManifest({ ...valid, version: 'x' }, null)).toThrow();
  });
  it('description 空抛错', () => {
    expect(() => validateManifest({ ...valid, description: '   ' }, null)).toThrow();
  });
});
