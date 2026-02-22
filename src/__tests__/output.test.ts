import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatSearchOutput, writeOutput, writeError } from '../output.js';
import type { SearchResult, BaseDocument } from '@prodisco/search-libs';

describe('output', () => {
  describe('formatSearchOutput', () => {
    it('formats search results into CLI output schema', () => {
      const mockResult: SearchResult<BaseDocument> = {
        results: [],
        totalMatches: 0,
        facets: {
          documentType: {},
          library: {},
          category: {},
        },
        searchTime: 1.234,
      };

      const output = formatSearchOutput(mockResult);
      expect(output).toHaveProperty('summary');
      expect(output).toHaveProperty('results');
      expect(output).toHaveProperty('totalMatches');
      expect(output).toHaveProperty('facets');
      expect(output).toHaveProperty('pagination');
      expect(output).toHaveProperty('searchTimeMs');
      expect(output.totalMatches).toBe(0);
    });
  });

  describe('writeOutput', () => {
    let stdoutWrite: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutWrite.mockRestore();
    });

    it('writes JSON to stdout', () => {
      writeOutput({ foo: 'bar' });
      expect(stdoutWrite).toHaveBeenCalledOnce();
      const written = stdoutWrite.mock.calls[0]![0] as string;
      expect(JSON.parse(written)).toEqual({ foo: 'bar' });
    });
  });

  describe('writeError', () => {
    let stdoutWrite: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutWrite.mockRestore();
    });

    it('writes error JSON to stdout', () => {
      writeError('something went wrong');
      const written = stdoutWrite.mock.calls[0]![0] as string;
      expect(JSON.parse(written)).toEqual({ error: 'something went wrong' });
    });
  });
});
