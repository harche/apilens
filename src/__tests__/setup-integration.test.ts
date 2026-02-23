import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', 'cli.ts');

function runCLI(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
      cwd,
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

describe('setup integration', () => {
  let tmpDir: string;
  let configPath: string;
  let result: { stdout: string; stderr: string; code: number | null };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apilens-integration-'));

    configPath = path.join(tmpDir, '.apilens.yaml');
    fs.writeFileSync(
      configPath,
      `libraries:
  - name: minimist
    title: argument parser
    description: Parse argument options
`,
    );

    result = await runCLI(['setup', '--config', configPath], tmpDir);
  }, 60_000);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits with code 0', () => {
    expect(result.code).toBe(0);
  });

  it('outputs valid JSON with success message and library info', () => {
    const output = JSON.parse(result.stdout);
    expect(output.message).toBe('Skill files installed successfully');
    expect(output.libraries).toEqual(['minimist']);
    expect(output.modulePaths).toHaveProperty('minimist');
    expect(output.modulePaths.minimist).toContain('node_modules/minimist');
    expect(output.files).toBeInstanceOf(Array);
    expect(output.files.length).toBe(4); // binstub + SKILL.md + 1 ref + symlink
  });

  it('generates SKILL.md with library name, title, and module path', () => {
    const skillMd = fs.readFileSync(
      path.join(tmpDir, '.claude', 'skills', 'apilens', 'SKILL.md'),
      'utf-8',
    );
    expect(skillMd).toContain('minimist');
    expect(skillMd).toContain('(argument parser)');
    expect(skillMd).toContain('node_modules/minimist');
    expect(skillMd).toContain('type declarations');
    expect(skillMd).toContain('[minimist](references/minimist.md)');
  });

  it('generates per-library reference file with correct content', () => {
    const ref = fs.readFileSync(
      path.join(tmpDir, '.claude', 'skills', 'apilens', 'references', 'minimist.md'),
      'utf-8',
    );
    expect(ref).toContain('# minimist');
    expect(ref).toContain('Parse argument options');
    expect(ref).toContain('## Module path');
    expect(ref).toContain('node_modules/minimist');
    expect(ref).toContain('package.json');
  });

  it('creates executable binstub', () => {
    const binstubPath = path.join(tmpDir, '.claude', 'skills', 'apilens', 'bin', 'apilens');
    const content = fs.readFileSync(binstubPath, 'utf-8');
    expect(content).toBe('#!/bin/sh\nexec apilens "$@"\n');

    const stat = fs.statSync(binstubPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('creates .agents/skills/apilens symlink', () => {
    const link = path.join(tmpDir, '.agents', 'skills', 'apilens');
    expect(fs.existsSync(link)).toBe(true);

    const linkTarget = fs.readlinkSync(link);
    const expectedTarget = path.join(tmpDir, '.claude', 'skills', 'apilens');
    expect(fs.realpathSync(linkTarget)).toBe(fs.realpathSync(expectedTarget));
  });
});
