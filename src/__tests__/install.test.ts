import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock the resolver module before importing install
vi.mock('../resolver.js', () => ({
  resolvePackages: vi.fn(),
  installPackagesLocally: vi.fn(),
}));

import { installCommand } from '../commands/install.js';
import { resolvePackages, installPackagesLocally } from '../resolver.js';
import type { CLIArgs, ApilensConfig } from '../types.js';

function makeArgs(overrides: Partial<CLIArgs> = {}): CLIArgs {
  return {
    command: 'install',
    positional: [],
    limit: 10,
    offset: 0,
    verbose: false,
    quiet: true, // suppress stderr noise in tests
    help: false,
    version: false,
    skills: true,
    timeout: 30000,
    ...overrides,
  };
}

const mockConfig: ApilensConfig = {
  libraries: [
    { name: 'test-lib', title: 'a test utility library', description: 'A test library' },
    { name: '@scope/pkg', title: 'scoped package for testing' },
  ],
};

function setupMocks(basePath: string) {
  // Create mock package directories so findPackageDir can resolve them
  fs.mkdirSync(path.join(basePath, 'node_modules', 'test-lib'), { recursive: true });
  fs.mkdirSync(path.join(basePath, 'node_modules', '@scope', 'pkg'), { recursive: true });

  vi.mocked(installPackagesLocally).mockResolvedValue({
    installed: [],
    alreadyPresent: ['test-lib', '@scope/pkg'],
  });

  vi.mocked(resolvePackages).mockResolvedValue({
    basePaths: [basePath],
    resolved: ['test-lib', '@scope/pkg'],
    failed: [],
  });
}

describe('installCommand', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apilens-install-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('errors when --skills not provided', async () => {
    await installCommand(makeArgs({ skills: false }), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toHaveProperty('error');
    expect(process.exitCode).toBe(1);
  });

  it('errors when no packages resolved', async () => {
    vi.mocked(installPackagesLocally).mockResolvedValue({
      installed: [],
      alreadyPresent: [],
    });
    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: [],
      resolved: [],
      failed: ['test-lib'],
    });

    await installCommand(makeArgs(), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toHaveProperty('error');
    expect(process.exitCode).toBe(1);
  });

  describe('default directory', () => {
    beforeEach(() => setupMocks(tmpDir));

    it('writes files to .claude/skills/apilens/', async () => {
      await installCommand(makeArgs(), mockConfig);

      const targetDir = path.join(tmpDir, '.claude', 'skills', 'apilens');
      expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'bin', 'apilens'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'references', 'test-lib.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'references', 'scope-pkg.md'))).toBe(true);
    });

    it('creates Codex symlink at .agents/skills/apilens', async () => {
      await installCommand(makeArgs(), mockConfig);

      const codexLink = path.join(tmpDir, '.agents', 'skills', 'apilens');
      expect(fs.existsSync(codexLink)).toBe(true);
      const linkTarget = fs.readlinkSync(codexLink);
      const expectedTarget = path.join(tmpDir, '.claude', 'skills', 'apilens');
      // Resolve /private/var vs /var symlink on macOS
      expect(fs.realpathSync(linkTarget)).toBe(fs.realpathSync(expectedTarget));
    });

    it('generates SKILL.md with library names, titles, and module paths', async () => {
      await installCommand(makeArgs(), mockConfig);

      const skillMd = fs.readFileSync(
        path.join(tmpDir, '.claude', 'skills', 'apilens', 'SKILL.md'),
        'utf-8',
      );
      expect(skillMd).toContain('test-lib');
      expect(skillMd).toContain('(a test utility library)');
      expect(skillMd).toContain('@scope/pkg');
      expect(skillMd).toContain('(scoped package for testing)');
      expect(skillMd).toContain('apilens');
      expect(skillMd).toContain('node_modules/test-lib');
      expect(skillMd).toContain('type declarations');
    });

    it('generates reference files with module paths', async () => {
      await installCommand(makeArgs(), mockConfig);

      const refsDir = path.join(tmpDir, '.claude', 'skills', 'apilens', 'references');

      const testLibRef = fs.readFileSync(path.join(refsDir, 'test-lib.md'), 'utf-8');
      expect(testLibRef).toContain('# test-lib');
      expect(testLibRef).toContain('A test library');
      expect(testLibRef).toContain('## Module path');
      expect(testLibRef).toContain('node_modules/test-lib');

      const scopePkgRef = fs.readFileSync(path.join(refsDir, 'scope-pkg.md'), 'utf-8');
      expect(scopePkgRef).toContain('# @scope/pkg');
      expect(scopePkgRef).toContain('node_modules/@scope/pkg');
    });

    it('creates executable binstub', async () => {
      await installCommand(makeArgs(), mockConfig);

      const binstubPath = path.join(tmpDir, '.claude', 'skills', 'apilens', 'bin', 'apilens');
      const content = fs.readFileSync(binstubPath, 'utf-8');
      expect(content).toBe('#!/bin/sh\nexec apilens "$@"\n');

      const stat = fs.statSync(binstubPath);
      // Check executable bit is set
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });

    it('outputs JSON with file list and module paths', async () => {
      await installCommand(makeArgs(), mockConfig);

      const written = stdoutWrite.mock.calls[0]![0] as string;
      const output = JSON.parse(written);
      expect(output.message).toBe('Skill files installed successfully');
      expect(output.libraries).toEqual(['test-lib', '@scope/pkg']);
      expect(output.modulePaths).toHaveProperty('test-lib');
      expect(output.modulePaths).toHaveProperty('@scope/pkg');
      expect(output.files).toBeInstanceOf(Array);
      expect(output.files.length).toBe(5); // binstub + SKILL.md + 2 refs + symlink
    });
  });

  describe('--dir option', () => {
    beforeEach(() => setupMocks(tmpDir));

    it('writes files to custom directory', async () => {
      const customDir = path.join(tmpDir, 'custom', 'output');
      await installCommand(makeArgs({ dir: customDir }), mockConfig);

      // Should append apilens/ since path doesn't end with it
      const targetDir = path.join(customDir, 'apilens');
      expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'bin', 'apilens'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'references', 'test-lib.md'))).toBe(true);
    });

    it('does not append apilens/ when path already ends with it', async () => {
      const customDir = path.join(tmpDir, 'container', 'skills', 'apilens');
      await installCommand(makeArgs({ dir: customDir }), mockConfig);

      // Should NOT create container/skills/apilens/apilens/
      expect(fs.existsSync(path.join(customDir, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(customDir, 'apilens', 'SKILL.md'))).toBe(false);
    });

    it('skips Codex symlink when custom dir is specified', async () => {
      const customDir = path.join(tmpDir, 'custom', 'skills', 'apilens');
      await installCommand(makeArgs({ dir: customDir }), mockConfig);

      // .agents/ should not exist
      expect(fs.existsSync(path.join(tmpDir, '.agents'))).toBe(false);
    });

    it('outputs JSON with custom destination path', async () => {
      const customDir = path.join(tmpDir, 'my-skills', 'apilens');
      await installCommand(makeArgs({ dir: customDir }), mockConfig);

      const written = stdoutWrite.mock.calls[0]![0] as string;
      const output = JSON.parse(written);
      expect(output.destination).toBe(customDir);
      // 3 file types: binstub + SKILL.md + 2 refs (no symlink)
      expect(output.files.length).toBe(4);
    });

    it('resolves relative --dir paths', async () => {
      await installCommand(makeArgs({ dir: 'rel/path' }), mockConfig);

      const targetDir = path.join(tmpDir, 'rel', 'path', 'apilens');
      expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    });
  });
});
