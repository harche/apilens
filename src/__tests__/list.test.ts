import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCommand } from '../commands/list.js';
import type { CLIArgs, ApilensConfig } from '../types.js';

function makeArgs(overrides: Partial<CLIArgs> = {}): CLIArgs {
  return {
    command: 'list',
    positional: [],
    limit: 10,
    offset: 0,
    verbose: false,
    quiet: false,
    help: false,
    version: false,
    skills: false,
    timeout: 30000,
    ...overrides,
  };
}

describe('listCommand', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it('outputs libraries with descriptions', async () => {
    const config: ApilensConfig = {
      libraries: [
        { name: '@kubernetes/client-node', title: 'Kubernetes TypeScript client', description: 'K8s client' },
        { name: 'pg', title: 'postgres typescript library', description: 'PostgreSQL driver' },
      ],
    };

    await listCommand(makeArgs(), config);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    const output = JSON.parse(written);
    expect(output.count).toBe(2);
    expect(output.libraries).toEqual([
      { name: '@kubernetes/client-node', title: 'Kubernetes TypeScript client', description: 'K8s client' },
      { name: 'pg', title: 'postgres typescript library', description: 'PostgreSQL driver' },
    ]);
  });

  it('outputs libraries without descriptions as null', async () => {
    const config: ApilensConfig = {
      libraries: [{ name: 'lodash', title: 'utility library' }],
    };

    await listCommand(makeArgs(), config);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    const output = JSON.parse(written);
    expect(output.count).toBe(1);
    expect(output.libraries[0]).toEqual({ name: 'lodash', title: 'utility library', description: null });
  });

  it('handles empty libraries array', async () => {
    // This shouldn't normally happen (config validation prevents it),
    // but test the command handles it gracefully
    const config: ApilensConfig = { libraries: [] };

    await listCommand(makeArgs(), config);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    const output = JSON.parse(written);
    expect(output.count).toBe(0);
    expect(output.libraries).toEqual([]);
  });
});
