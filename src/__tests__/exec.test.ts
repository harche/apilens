import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../resolver.js', () => ({
  resolvePackages: vi.fn(),
}));

// Keep a reference to the mock execute function that tests can configure
const mockExecute = vi.fn();

vi.mock('../sandbox.js', () => ({
  Sandbox: vi.fn().mockImplementation(function () {
    return { execute: mockExecute };
  }),
}));

import { execCommand } from '../commands/exec.js';
import { resolvePackages } from '../resolver.js';
import type { CLIArgs, ApilensConfig } from '../types.js';

function makeArgs(overrides: Partial<CLIArgs> = {}): CLIArgs {
  return {
    command: 'exec',
    positional: [],
    verbose: false,
    quiet: false,
    help: false,
    version: false,
    skills: false,
    timeout: 30000,
    ...overrides,
  };
}

const mockConfig: ApilensConfig = {
  libraries: [{ name: 'test-lib', title: 'a test library' }],
};

describe('execCommand', () => {
  let tmpDir: string;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let processExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apilens-exec-test-'));
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    processExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    process.exitCode = undefined;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    processExit.mockRestore();
    process.exitCode = undefined;
  });

  it('errors when file not found', async () => {
    await execCommand(
      makeArgs({ positional: ['/nonexistent/script.ts'] }),
      mockConfig,
    );

    const stderrCalls = stderrWrite.mock.calls.map((c) => c[0] as string);
    expect(stderrCalls.some((s) => s.includes('File not found'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('errors when file is empty', async () => {
    const emptyFile = path.join(tmpDir, 'empty.ts');
    fs.writeFileSync(emptyFile, '   \n  \n');

    await execCommand(
      makeArgs({ positional: [emptyFile] }),
      mockConfig,
    );

    const stderrCalls = stderrWrite.mock.calls.map((c) => c[0] as string);
    expect(stderrCalls.some((s) => s.includes('No code provided'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('errors when no packages resolved', async () => {
    const scriptFile = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(scriptFile, 'console.log("hello")');

    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: [],
      resolved: [],
      failed: ['test-lib'],
    });

    await execCommand(
      makeArgs({ positional: [scriptFile] }),
      mockConfig,
    );

    const stderrCalls = stderrWrite.mock.calls.map((c) => c[0] as string);
    expect(stderrCalls.some((s) => s.includes('Run `apilens install --skills` first'))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('executes code from file and writes output', async () => {
    const scriptFile = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(scriptFile, 'console.log("hello world")');

    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    mockExecute.mockResolvedValue({
      success: true,
      output: 'hello world',
      executionTimeMs: 10,
      outputLineCount: 1,
      outputCharCount: 11,
      truncated: false,
    });

    await execCommand(
      makeArgs({ positional: [scriptFile] }),
      mockConfig,
    );

    expect(mockExecute).toHaveBeenCalledOnce();
    const stdoutCalls = stdoutWrite.mock.calls.map((c) => c[0] as string);
    expect(stdoutCalls.some((s) => s.includes('hello world'))).toBe(true);
    expect(processExit).toHaveBeenCalledWith(0);
  });

  it('exits with 1 on execution failure', async () => {
    const scriptFile = path.join(tmpDir, 'bad.ts');
    fs.writeFileSync(scriptFile, 'throw new Error("boom")');

    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    mockExecute.mockResolvedValue({
      success: false,
      output: '',
      error: 'boom',
      executionTimeMs: 5,
      outputLineCount: 0,
      outputCharCount: 0,
      truncated: false,
    });

    await execCommand(
      makeArgs({ positional: [scriptFile] }),
      mockConfig,
    );

    const stderrCalls = stderrWrite.mock.calls.map((c) => c[0] as string);
    expect(stderrCalls.some((s) => s.includes('boom'))).toBe(true);
    expect(processExit).toHaveBeenCalledWith(1);
  });

  it('passes timeout from args to sandbox', async () => {
    const scriptFile = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(scriptFile, 'console.log("hi")');

    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    mockExecute.mockResolvedValue({
      success: true,
      output: 'hi',
      executionTimeMs: 5,
      outputLineCount: 1,
      outputCharCount: 2,
      truncated: false,
    });

    await execCommand(
      makeArgs({ positional: [scriptFile], timeout: 60000 }),
      mockConfig,
    );

    expect(mockExecute).toHaveBeenCalledWith(
      'console.log("hi")',
      60000,
    );
  });
});
