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
    it('parses YAML config with title and description', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(
        configPath,
        `libraries:
  - name: "@kubernetes/client-node"
    title: "Kubernetes TypeScript client"
    description: "K8s client"
  - name: "pg"
    title: "postgres typescript library"
`,
      );

      const config = parseConfigFile(configPath);
      expect(config.libraries).toHaveLength(2);
      expect(config.libraries[0]!.name).toBe('@kubernetes/client-node');
      expect(config.libraries[0]!.title).toBe('Kubernetes TypeScript client');
      expect(config.libraries[0]!.description).toBe('K8s client');
      expect(config.libraries[1]!.name).toBe('pg');
      expect(config.libraries[1]!.title).toBe('postgres typescript library');
      expect(config.libraries[1]!.description).toBeUndefined();
    });

    it('parses JSON config', () => {
      const configPath = path.join(tmpDir, '.apilens.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ libraries: [{ name: 'foo', title: 'foo library' }] }),
      );

      const config = parseConfigFile(configPath);
      expect(config.libraries).toHaveLength(1);
      expect(config.libraries[0]!.name).toBe('foo');
      expect(config.libraries[0]!.title).toBe('foo library');
    });

    it('rejects string-only library entries (title is required)', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'libraries:\n  - simple-statistics\n');

      expect(() => parseConfigFile(configPath)).toThrow('must be an object');
    });

    it('rejects entries missing title', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(configPath, 'libraries:\n  - name: foo\n');

      expect(() => parseConfigFile(configPath)).toThrow('must have a non-empty "title"');
    });

    it('rejects duplicate library names', () => {
      const configPath = path.join(tmpDir, '.apilens.yaml');
      fs.writeFileSync(
        configPath,
        'libraries:\n  - name: foo\n    title: "foo lib"\n  - name: foo\n    title: "foo lib"\n',
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
    it('throws when no config found', () => {
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
