import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { ApilensConfig, LibrarySpec } from './types.js';

const CONFIG_FILENAMES = ['.apilens.yaml', '.apilens.yml', '.apilens.json'];

/**
 * Discover the config file by walking upward from startDir.
 * Priority: --config flag > APILENS_CONFIG env var > file discovery walking upward.
 */
export function discoverConfigPath(
  explicitPath?: string,
  startDir: string = process.cwd(),
): string | null {
  // 1. Explicit --config flag
  if (explicitPath) {
    const resolved = path.resolve(startDir, explicitPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    throw new Error(`Config file not found: ${resolved}`);
  }

  // 2. APILENS_CONFIG env var
  const envPath = process.env['APILENS_CONFIG'];
  if (envPath) {
    const resolved = path.resolve(startDir, envPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    throw new Error(`Config file from APILENS_CONFIG not found: ${resolved}`);
  }

  // 3. Walk upward from startDir
  let dir = path.resolve(startDir);
  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Parse a config file (YAML or JSON) into an ApilensConfig.
 */
export function parseConfigFile(configPath: string): ApilensConfig {
  const content = fs.readFileSync(configPath, 'utf-8');
  const ext = path.extname(configPath).toLowerCase();

  let parsed: unknown;
  if (ext === '.json') {
    parsed = JSON.parse(content);
  } else {
    parsed = YAML.parse(content);
  }

  return validateConfig(parsed, configPath);
}

/**
 * Validate raw parsed config data.
 */
function validateConfig(data: unknown, source: string): ApilensConfig {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid config in ${source}: expected an object`);
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['libraries'])) {
    throw new Error(`Invalid config in ${source}: "libraries" must be an array`);
  }

  const libraries: LibrarySpec[] = [];
  const seen = new Set<string>();

  for (const item of obj['libraries']) {
    if (!item || typeof item !== 'object') {
      throw new Error(
        `Invalid config in ${source}: each library must be an object with "name" and "title"`,
      );
    }
    const spec = item as Record<string, unknown>;
    if (typeof spec['name'] !== 'string' || !spec['name'].trim()) {
      throw new Error(`Invalid config in ${source}: each library must have a non-empty "name"`);
    }
    if (typeof spec['title'] !== 'string' || !spec['title'].trim()) {
      throw new Error(`Invalid config in ${source}: each library must have a non-empty "title"`);
    }
    const name = spec['name'] as string;
    const title = spec['title'] as string;
    if (seen.has(name)) {
      throw new Error(`Duplicate library name in ${source}: ${name}`);
    }
    seen.add(name);
    libraries.push({
      name,
      title,
      description: typeof spec['description'] === 'string' ? spec['description'] : undefined,
    });
  }

  if (libraries.length === 0) {
    throw new Error(`Invalid config in ${source}: at least one library is required`);
  }

  return { libraries };
}

/**
 * Load config: from file, from --library flag as ad-hoc, or fail.
 */
export function loadConfig(args: {
  config?: string;
  library?: string;
}): ApilensConfig {
  const configPath = discoverConfigPath(args.config);

  if (configPath) {
    return parseConfigFile(configPath);
  }

  // If no config found but --library is provided, use ad-hoc config
  if (args.library) {
    return {
      libraries: [{ name: args.library, title: args.library }],
    };
  }

  throw new Error(
    'No config file found. Create .apilens.yaml or use --library <name> to specify a library.',
  );
}
