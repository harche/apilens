import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeOutput, writeError } from '../output.js';

describe('output', () => {
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
