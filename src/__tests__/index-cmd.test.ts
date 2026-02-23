import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../resolver.js', () => ({
  resolvePackages: vi.fn(),
}));

vi.mock('../indexer.js', () => ({
  getIndexer: vi.fn(),
  shutdownIndexer: vi.fn(),
}));

import { indexCommand } from '../commands/index-cmd.js';
import { resolvePackages } from '../resolver.js';
import { getIndexer, shutdownIndexer } from '../indexer.js';
import type { CLIArgs, ApilensConfig } from '../types.js';

function makeArgs(overrides: Partial<CLIArgs> = {}): CLIArgs {
  return {
    command: 'index',
    positional: [],
    limit: 10,
    offset: 0,
    verbose: false,
    quiet: true,
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

describe('indexCommand', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('errors when no packages resolved', async () => {
    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: [],
      resolved: [],
      failed: ['test-lib'],
    });

    await indexCommand(makeArgs(), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toHaveProperty('error');
    expect(process.exitCode).toBe(1);
  });

  it('builds index and outputs results', async () => {
    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    const mockSearch = vi.fn().mockResolvedValue({
      results: [],
      totalMatches: 100,
      facets: { documentType: { method: 50 }, library: { 'test-lib': 100 }, category: {} },
      searchTime: 0.1,
    });

    vi.mocked(getIndexer).mockResolvedValue({
      search: mockSearch,
      isInitialized: () => true,
    } as any);

    vi.mocked(shutdownIndexer).mockResolvedValue(undefined);

    await indexCommand(makeArgs(), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    const output = JSON.parse(written);
    expect(output.message).toBe('Index built successfully');
    expect(output.totalDocuments).toBe(100);
    expect(output.facets).toBeDefined();
    expect(process.exitCode).toBeUndefined();
  });

  it('shows warnings for failed resolutions when not quiet', async () => {
    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: ['missing-lib'],
    });

    const mockSearch = vi.fn().mockResolvedValue({
      results: [],
      totalMatches: 10,
      facets: { documentType: {}, library: {}, category: {} },
      searchTime: 0.1,
    });

    vi.mocked(getIndexer).mockResolvedValue({
      search: mockSearch,
      isInitialized: () => true,
    } as any);

    vi.mocked(shutdownIndexer).mockResolvedValue(undefined);

    await indexCommand(makeArgs({ quiet: false }), mockConfig);

    const stderrCalls = stderrWrite.mock.calls.map((c) => c[0] as string);
    expect(stderrCalls.some((s) => s.includes('missing-lib'))).toBe(true);
  });

  it('calls shutdownIndexer after completion', async () => {
    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    const mockSearch = vi.fn().mockResolvedValue({
      results: [],
      totalMatches: 0,
      facets: { documentType: {}, library: {}, category: {} },
      searchTime: 0.1,
    });

    vi.mocked(getIndexer).mockResolvedValue({
      search: mockSearch,
      isInitialized: () => true,
    } as any);

    vi.mocked(shutdownIndexer).mockResolvedValue(undefined);

    await indexCommand(makeArgs(), mockConfig);

    expect(shutdownIndexer).toHaveBeenCalledOnce();
  });

  it('handles indexer errors gracefully', async () => {
    vi.mocked(resolvePackages).mockResolvedValue({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    vi.mocked(getIndexer).mockRejectedValue(new Error('Indexing failed'));

    await indexCommand(makeArgs(), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toEqual({ error: 'Indexing failed' });
    expect(process.exitCode).toBe(1);
  });
});
