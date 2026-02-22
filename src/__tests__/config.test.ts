import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverConfigPath, parseConfigFile, loadConfig } from '../config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apilens-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('discoverConfigPath', () => {
    it('returns explicit path if it exists', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'libraries:\n  - name: foo\n');

      const result = discoverConfigPath(configPath, tmpDir);
      expect(result).toBe(configPath);
    });

    it('throws if explicit path does not exist', () => {
      expect(() => discoverConfigPath('/nonexistent/.apilens.yaml', tmpDir)).toThrow(
        'Config file not found',
      );
    });

    it('finds config walking upward', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'libraries:\n  - name: foo\n');
      const subDir = path.join(tmpDir, 'a', 'b', 'c');
      fs.mkdirSync(subDir, { recursive: true });

      const result = discoverConfigPath(undefined, subDir);
      expect(result).toBe(configPath);
    });

    it('returns null if no config found', () => {
      const result = discoverConfigPath(undefined, tmpDir);
      expect(result).toBeNull();
    });
  });

  describe('parseConfigFile', () => {
    it('parses YAML config', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(
        configPath,
        `libraries:
  - name: "@kubernetes/client-node"
    description: "K8s client"
  - name: "pg"
`,
      );

      const config = parseConfigFile(configPath);
      expect(config.libraries).toHaveLength(2);
      expect(config.libraries[0]!.name).toBe('@kubernetes/client-node');
      expect(config.libraries[0]!.description).toBe('K8s client');
      expect(config.libraries[1]!.name).toBe('pg');
      expect(config.libraries[1]!.description).toBeUndefined();
    });

    it('parses JSON config', () => {
      const configPath = path.join(tmpDir, '.apilens.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ libraries: [{ name: 'foo' }] }),
      );

      const config = parseConfigFile(configPath);
      expect(config.libraries).toHaveLength(1);
      expect(config.libraries[0]!.name).toBe('foo');
    });

    it('accepts string-only library entries', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'libraries:\n  - simple-statistics\n');

      const config = parseConfigFile(configPath);
      expect(config.libraries).toHaveLength(1);
      expect(config.libraries[0]!.name).toBe('simple-statistics');
    });

    it('rejects duplicate library names', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(
        configPath,
        'libraries:\n  - name: foo\n  - name: foo\n',
      );

      expect(() => parseConfigFile(configPath)).toThrow('Duplicate library name');
    });

    it('rejects empty libraries array', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'libraries: []\n');

      expect(() => parseConfigFile(configPath)).toThrow('at least one library');
    });

    it('rejects missing libraries key', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'foo: bar\n');

      expect(() => parseConfigFile(configPath)).toThrow('"libraries" must be an array');
    });
  });

  describe('loadConfig', () => {
    it('uses --library as ad-hoc config when no file found', () => {
      const config = loadConfig({ library: 'some-lib' });
      expect(config.libraries).toHaveLength(1);
      expect(config.libraries[0]!.name).toBe('some-lib');
    });

    it('throws when no config and no library flag', () => {
      // Use a directory that definitely has no .apilens.yaml
      const originalCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        expect(() => loadConfig({})).toThrow('No config file found');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
