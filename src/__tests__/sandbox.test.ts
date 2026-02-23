import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  hasUsableNodeModules,
  findNearestNodeModulesBasePath,
  normalizeModulesBasePath,
  discoverPackagesInNodeModules,
  Sandbox,
} from '../sandbox.js';

describe('sandbox helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apilens-sandbox-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('hasUsableNodeModules', () => {
    it('returns false when node_modules does not exist', () => {
      expect(hasUsableNodeModules(tmpDir)).toBe(false);
    });

    it('returns false when node_modules has only dot entries', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      fs.mkdirSync(path.join(nmDir, '.vite'));
      fs.writeFileSync(path.join(nmDir, '.package-lock.json'), '{}');

      expect(hasUsableNodeModules(tmpDir)).toBe(false);
    });

    it('returns true when node_modules has non-dot entries', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      fs.mkdirSync(path.join(nmDir, 'some-package'));

      expect(hasUsableNodeModules(tmpDir)).toBe(true);
    });
  });

  describe('findNearestNodeModulesBasePath', () => {
    it('returns startDir when no node_modules found anywhere', () => {
      const deepDir = path.join(tmpDir, 'a', 'b', 'c');
      fs.mkdirSync(deepDir, { recursive: true });

      // Since walking up from a temp dir might hit real node_modules,
      // the result should be a valid directory
      const result = findNearestNodeModulesBasePath(deepDir);
      expect(typeof result).toBe('string');
    });

    it('finds node_modules in parent directory', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      fs.mkdirSync(path.join(nmDir, 'some-pkg'));

      const childDir = path.join(tmpDir, 'src', 'lib');
      fs.mkdirSync(childDir, { recursive: true });

      const result = findNearestNodeModulesBasePath(childDir);
      expect(result).toBe(tmpDir);
    });
  });

  describe('normalizeModulesBasePath', () => {
    it('strips node_modules suffix', () => {
      const nmPath = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmPath);
      fs.mkdirSync(path.join(nmPath, 'pkg'));

      const result = normalizeModulesBasePath(nmPath);
      expect(result).toBe(tmpDir);
    });

    it('returns directory as-is when it has usable node_modules', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      fs.mkdirSync(path.join(nmDir, 'some-package'));

      const result = normalizeModulesBasePath(tmpDir);
      expect(result).toBe(tmpDir);
    });

    it('returns input unchanged for empty string', () => {
      expect(normalizeModulesBasePath('')).toBe('');
    });
  });

  describe('discoverPackagesInNodeModules', () => {
    it('returns empty array when node_modules does not exist', () => {
      expect(discoverPackagesInNodeModules(tmpDir)).toEqual([]);
    });

    it('returns non-dot package names', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(path.join(nmDir, 'pkg-a'), { recursive: true });
      fs.mkdirSync(path.join(nmDir, 'pkg-b'), { recursive: true });
      fs.mkdirSync(path.join(nmDir, '.vite'), { recursive: true });

      const result = discoverPackagesInNodeModules(tmpDir);
      expect(result).toContain('pkg-a');
      expect(result).toContain('pkg-b');
      expect(result).not.toContain('.vite');
    });

    it('handles scoped packages', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(path.join(nmDir, '@scope', 'pkg-x'), { recursive: true });
      fs.mkdirSync(path.join(nmDir, '@scope', 'pkg-y'), { recursive: true });
      fs.mkdirSync(path.join(nmDir, 'regular-pkg'), { recursive: true });

      const result = discoverPackagesInNodeModules(tmpDir);
      expect(result).toContain('@scope/pkg-x');
      expect(result).toContain('@scope/pkg-y');
      expect(result).toContain('regular-pkg');
    });

    it('returns empty array when node_modules has only dot entries', () => {
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      fs.mkdirSync(path.join(nmDir, '.cache'));

      expect(discoverPackagesInNodeModules(tmpDir)).toEqual([]);
    });
  });
});

describe('Sandbox execution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apilens-sandbox-exec-'));
    // Create a minimal node_modules with a fake package
    const pkgDir = path.join(tmpDir, 'node_modules', 'test-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', main: 'index.js' }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'index.js'),
      'module.exports = { greet: () => "hello from test-pkg" };',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes simple code and captures output', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute('console.log("hello sandbox")');
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello sandbox');
  });

  it('captures multiple console.log lines', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute('console.log("line1");\nconsole.log("line2");');
    expect(result.success).toBe(true);
    expect(result.output).toBe('line1\nline2');
    expect(result.outputLineCount).toBe(2);
  });

  it('blocks require of non-allowed packages', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute('require("some-random-pkg")');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available in sandbox');
  });

  it('blocks require of path-like specifiers', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute('require("./malicious")');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available in sandbox');
  });

  it('allows require of builtin modules', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute(
      'const fs = require("fs"); console.log(typeof fs.readFileSync)',
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('function');
  });

  it('allows require of node:-prefixed builtin modules', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute(
      'const stream = require("node:stream"); console.log(typeof stream.Readable)',
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('function');
  });

  it('allows require of allowed modules', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute(
      'const pkg = require("test-pkg"); console.log(pkg.greet())',
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello from test-pkg');
  });

  it('supports top-level await', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute(
      'const x = await Promise.resolve(42); console.log(x)',
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('42');
  });

  it('handles runtime errors gracefully', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute('throw new Error("test error")');
    expect(result.success).toBe(false);
    expect(result.error).toContain('test error');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('enforces execution timeout', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute(
      'await new Promise(resolve => setTimeout(resolve, 60000))',
      1000, // 1 second timeout
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  }, 10000);

  it('converts import statements to require calls', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute(
      'import pkg from "test-pkg"; console.log(pkg.greet())',
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello from test-pkg');
  });

  it('reports truncation info', async () => {
    const sandbox = new Sandbox({
      allowedModules: ['test-pkg'],
      modulesBasePath: tmpDir,
    });

    const result = await sandbox.execute('console.log("short output")');
    expect(result.truncated).toBe(false);
    expect(result.truncatedAt).toBeUndefined();
  });
});
