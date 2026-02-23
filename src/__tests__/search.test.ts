import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the resolver and indexer modules before importing search
vi.mock('../resolver.js', () => ({
  resolvePackages: vi.fn(),
}));

vi.mock('../indexer.js', () => ({
  getIndexer: vi.fn(),
  shutdownIndexer: vi.fn(),
}));

import { searchCommand } from '../commands/search.js';
import { resolvePackages } from '../resolver.js';
import { getIndexer, shutdownIndexer } from '../indexer.js';
import type { CLIArgs, ApilensConfig } from '../types.js';

function makeArgs(overrides: Partial<CLIArgs> = {}): CLIArgs {
  return {
    command: 'search',
    positional: [],
    limit: 10,
    offset: 0,
    verbose: false,
    quiet: false,
    help: false,
    version: false,
    skills: false,
    ...overrides,
  };
}

const mockConfig: ApilensConfig = {
  libraries: [{ name: 'test-lib', title: 'a test library' }],
};

describe('searchCommand', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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

  it('errors when no query provided', async () => {
    await searchCommand(makeArgs(), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toHaveProperty('error');
    expect(process.exitCode).toBe(1);
  });

  it('errors when no packages resolved', async () => {
    vi.mocked(resolvePackages).mockResolvedValueOnce({
      basePaths: [],
      resolved: [],
      failed: ['test-lib'],
    });

    await searchCommand(makeArgs({ query: 'test' }), mockConfig);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toHaveProperty('error');
    expect(process.exitCode).toBe(1);
  });

  it('performs search and writes JSON output', async () => {
    vi.mocked(resolvePackages).mockResolvedValueOnce({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    const mockSearch = vi.fn().mockResolvedValueOnce({
      results: [],
      totalMatches: 0,
      facets: { documentType: {}, library: {}, category: {} },
      searchTime: 0.5,
    });

    vi.mocked(getIndexer).mockResolvedValueOnce({
      search: mockSearch,
      isInitialized: () => true,
    } as any);

    vi.mocked(shutdownIndexer).mockResolvedValueOnce(undefined);

    await searchCommand(makeArgs({ query: 'test query' }), mockConfig);

    expect(mockSearch).toHaveBeenCalledOnce();
    const searchOpts = mockSearch.mock.calls[0]![0];
    expect(searchOpts.query).toBe('test query');
    expect(searchOpts.limit).toBe(10);

    const written = stdoutWrite.mock.calls[0]![0] as string;
    const output = JSON.parse(written);
    expect(output).toHaveProperty('summary');
    expect(output).toHaveProperty('results');
    expect(output).toHaveProperty('totalMatches');
    expect(process.exitCode).toBeUndefined();
  });

  it('applies filters from CLI args', async () => {
    vi.mocked(resolvePackages).mockResolvedValueOnce({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    const mockSearch = vi.fn().mockResolvedValueOnce({
      results: [],
      totalMatches: 0,
      facets: { documentType: {}, library: {}, category: {} },
      searchTime: 0.1,
    });

    vi.mocked(getIndexer).mockResolvedValueOnce({
      search: mockSearch,
      isInitialized: () => true,
    } as any);

    vi.mocked(shutdownIndexer).mockResolvedValueOnce(undefined);

    await searchCommand(
      makeArgs({
        query: 'pods',
        library: 'test-lib',
        type: 'method',
        category: 'list',
        limit: 5,
        offset: 10,
      }),
      mockConfig,
    );

    const searchOpts = mockSearch.mock.calls[0]![0];
    expect(searchOpts.library).toBe('test-lib');
    expect(searchOpts.documentType).toBe('method');
    expect(searchOpts.category).toBe('list');
    expect(searchOpts.limit).toBe(5);
    expect(searchOpts.offset).toBe(10);
  });

  it('uses --method as query when no positional query', async () => {
    vi.mocked(resolvePackages).mockResolvedValueOnce({
      basePaths: ['/tmp/test'],
      resolved: ['test-lib'],
      failed: [],
    });

    const mockSearch = vi.fn().mockResolvedValueOnce({
      results: [],
      totalMatches: 0,
      facets: { documentType: {}, library: {}, category: {} },
      searchTime: 0.1,
    });

    vi.mocked(getIndexer).mockResolvedValueOnce({
      search: mockSearch,
      isInitialized: () => true,
    } as any);

    vi.mocked(shutdownIndexer).mockResolvedValueOnce(undefined);

    await searchCommand(makeArgs({ method: 'listNamespacedPod' }), mockConfig);

    const searchOpts = mockSearch.mock.calls[0]![0];
    expect(searchOpts.query).toBe('listNamespacedPod');
  });
});
