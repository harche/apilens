import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', 'cli.ts');

function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
      cwd: path.resolve(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, APILENS_CONFIG: '' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

describe('CLI entry point', () => {
  it('shows help with --help', async () => {
    const result = await runCLI(['--help']);
    expect(result.stdout).toContain('apilens');
    expect(result.stdout).toContain('COMMANDS');
    expect(result.stdout).toContain('search');
    expect(result.stdout).toContain('list');
    expect(result.code).toBe(0);
  });

  it('shows help when no command given', async () => {
    const result = await runCLI([]);
    expect(result.stdout).toContain('apilens');
    expect(result.stdout).toContain('COMMANDS');
    expect(result.code).toBe(0);
  });

  it('shows version with --version', async () => {
    const result = await runCLI(['--version']);
    expect(result.stdout).toMatch(/apilens v\d+\.\d+\.\d+/);
    expect(result.code).toBe(0);
  });

  it('shows error for unknown command', async () => {
    const result = await runCLI(['foobar']);
    expect(result.stderr).toContain('Unknown command: foobar');
    expect(result.code).toBe(1);
  });

  it('search without query shows error', async () => {
    const result = await runCLI(['search', '-l', 'some-lib']);
    expect(result.stdout).toContain('error');
    expect(result.code).toBe(1);
  });

  it('help text includes INSTALL OPTIONS section', async () => {
    const result = await runCLI(['--help']);
    expect(result.stdout).toContain('INSTALL OPTIONS');
    expect(result.stdout).toContain('--dir <path>');
  });

  it('install without --skills shows error', async () => {
    const result = await runCLI(['install', '-l', 'some-lib']);
    expect(result.stdout).toContain('error');
    expect(result.code).toBe(1);
  });
});
