import vm from 'node:vm';
import { transform } from 'esbuild';
import { builtinModules, createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

// Output limits to prevent memory exhaustion
const MAX_OUTPUT_LINES = 5000;
const MAX_OUTPUT_CHARS = 500000; // 500KB

/**
 * Tracks output size and truncation state during execution.
 */
interface OutputTracker {
  lines: string[];
  charCount: number;
  truncated: boolean;
  truncatedAt?: { lines: number; chars: number };
}

export interface SandboxConfig {
  allowedModules: string[];
  modulesBasePath: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  outputLineCount: number;
  outputCharCount: number;
  truncated: boolean;
  truncatedAt?: { lines: number; chars: number };
}

const BUILTIN_MODULE_SET = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => (m.startsWith('node:') ? m.slice('node:'.length) : m)),
]);

function isBuiltinModule(specifier: string): boolean {
  const cleaned = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  return BUILTIN_MODULE_SET.has(specifier) || BUILTIN_MODULE_SET.has(cleaned);
}

function getPackageRootName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return specifier;
  }
  return specifier.split('/')[0] || specifier;
}

function isPathLike(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('\\')) {
    return true;
  }
  // Windows drive letter paths, e.g. C:\foo
  if (/^[A-Za-z]:[\\/]/.test(specifier)) {
    return true;
  }
  // Disallow protocol-like specifiers (file:, data:, etc.) but allow node: builtins.
  if (specifier.includes(':') && !specifier.startsWith('node:')) {
    return true;
  }
  return false;
}

export function hasUsableNodeModules(dir: string): boolean {
  const nodeModulesPath = path.join(dir, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    return false;
  }

  // node_modules can exist for tooling caches (e.g., vitest creates node_modules/.vite),
  // so require at least one non-dot entry to treat it as a real dependency root.
  try {
    const entries = readdirSync(nodeModulesPath);
    return entries.some((name) => !name.startsWith('.'));
  } catch {
    return false;
  }
}

export function findNearestNodeModulesBasePath(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (hasUsableNodeModules(dir)) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

export function normalizeModulesBasePath(inputPath: string): string {
  const p = inputPath.trim();
  if (!p) return inputPath;

  // Accept either the node_modules directory itself or its parent.
  if (path.basename(p) === 'node_modules') {
    const parent = path.dirname(p);
    return parent;
  }

  if (hasUsableNodeModules(p)) {
    return p;
  }

  return findNearestNodeModulesBasePath(p);
}

function resolveImportEntryFromBasePath(basePath: string, packageName: string): string | null {
  const nodeModulesPath = path.join(basePath, 'node_modules');
  const packageDir = packageName.startsWith('@')
    ? path.join(nodeModulesPath, ...packageName.split('/'))
    : path.join(nodeModulesPath, packageName);

  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Prefer ESM import entry from exports, then fall back to module/main.
  let entry: string | undefined;
  const exportsField = pkgJson.exports as unknown;

  if (typeof exportsField === 'string') {
    entry = exportsField;
  } else if (exportsField && typeof exportsField === 'object') {
    const exportsObj = exportsField as Record<string, unknown>;
    const rootExport = (exportsObj['.'] ?? exportsObj) as unknown;
    if (typeof rootExport === 'string') {
      entry = rootExport;
    } else if (rootExport && typeof rootExport === 'object') {
      const root = rootExport as Record<string, unknown>;
      if (typeof root.import === 'string') {
        entry = root.import;
      } else if (typeof root.default === 'string') {
        entry = root.default;
      } else if (typeof root.require === 'string') {
        entry = root.require;
      }
    }
  }

  if (!entry && typeof pkgJson.module === 'string') {
    entry = pkgJson.module;
  }
  if (!entry && typeof pkgJson.main === 'string') {
    entry = pkgJson.main;
  }
  if (!entry) {
    entry = 'index.js';
  }

  const rel = entry.startsWith('./') ? entry.slice(2) : entry;
  return path.resolve(packageDir, rel);
}

function isEsmOnlyPackage(basePath: string, packageName: string): boolean {
  const nodeModulesPath = path.join(basePath, 'node_modules');
  const packageDir = packageName.startsWith('@')
    ? path.join(nodeModulesPath, ...packageName.split('/'))
    : path.join(nodeModulesPath, packageName);

  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return false;
  }

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return false;
  }

  const exportsField = pkgJson.exports as unknown;
  if (exportsField && typeof exportsField === 'object') {
    const exportsObj = exportsField as Record<string, unknown>;
    const rootExport = (exportsObj['.'] ?? exportsObj) as unknown;
    if (rootExport && typeof rootExport === 'object') {
      const root = rootExport as Record<string, unknown>;
      // If the package explicitly provides a require entry, treat it as CJS-compatible.
      if (root.require !== undefined) {
        return false;
      }
      // If it provides an import entry (or default) without require, treat it as ESM-only.
      if (root.import !== undefined || root.default !== undefined) {
        return true;
      }
    }
  }

  // Fallback heuristic: type=module without explicit require mapping is likely ESM-only.
  return pkgJson.type === 'module';
}

/**
 * Pre-process import statements into require() calls so the code can be
 * wrapped in an async IIFE (import declarations must be at module top level,
 * but require() works anywhere).
 */
function convertImportsToRequires(code: string): string {
  let result = code;

  // import * as X from "Y" → const X = require("Y")
  result = result.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?/g,
    'const $1 = require($2);',
  );

  // import { A, B, ... } from "Y" → const { A, B, ... } = require("Y")
  result = result.replace(
    /import\s+(\{[^}]+\})\s+from\s+(['"][^'"]+['"])\s*;?/g,
    'const $1 = require($2);',
  );

  // import X from "Y" → const X = require("Y")
  result = result.replace(
    /import\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?/g,
    'const $1 = require($2);',
  );

  // import "Y" → require("Y")  (side-effect imports)
  result = result.replace(
    /import\s+(['"][^'"]+['"])\s*;?/g,
    'require($1);',
  );

  return result;
}

/**
 * Sandbox executes TypeScript code in a restricted VM environment.
 * Only modules in the allowlist can be required; builtins, filesystem paths,
 * and unlisted packages are blocked.
 */
export class Sandbox {
  private allowedModules: Set<string>;
  private basePath: string;
  private requireFromBase: NodeRequire;
  private moduleCache = new Map<string, unknown>();
  private preloadPromise: Promise<void> | null = null;

  constructor(config: SandboxConfig) {
    this.allowedModules = new Set(config.allowedModules);

    this.basePath = normalizeModulesBasePath(config.modulesBasePath);
    this.requireFromBase = createRequire(path.join(this.basePath, 'index.js'));

    // Start preloading in the background so async APIs can return quickly.
    this.preloadPromise = this.preloadAllowedModules().catch(() => undefined);
  }

  private async ensureAllowedModulesPreloaded(): Promise<void> {
    if (!this.preloadPromise) {
      this.preloadPromise = this.preloadAllowedModules();
    }
    await this.preloadPromise;
  }

  async preloadAllowedModules(): Promise<void> {
    for (const pkgName of this.allowedModules) {
      if (this.moduleCache.has(pkgName)) {
        continue;
      }

      if (!isEsmOnlyPackage(this.basePath, pkgName)) {
        continue;
      }

      const resolved = resolveImportEntryFromBasePath(this.basePath, pkgName);

      if (!resolved) {
        continue;
      }

      try {
        const imported = await import(pathToFileURL(resolved).href);
        this.moduleCache.set(pkgName, imported);
      } catch {
        // If import fails, leave it uncached; require() will throw later.
      }
    }
  }

  private safeRequire(mod: string): unknown {
    const fail = () => {
      throw new Error(`Module '${mod}' not available in sandbox`);
    };

    if (typeof mod !== 'string') {
      fail();
    }

    const spec = mod.trim();
    if (!spec) {
      fail();
    }

    if (isPathLike(spec)) {
      fail();
    }

    // Allow Node.js builtin modules (e.g. stream, http, events) so that
    // allowed packages whose internals depend on builtins work correctly.
    if (!isBuiltinModule(spec)) {
      const root = getPackageRootName(spec);
      if (!this.allowedModules.has(root)) {
        fail();
      }
    }

    // Prefer cached modules (needed for ESM-only packages)
    const cached = this.moduleCache.get(spec);
    if (cached) {
      return cached;
    }

    try {
      const loaded = this.requireFromBase(spec) as unknown;
      this.moduleCache.set(spec, loaded);
      return loaded;
    } catch {
      fail();
    }
  }

  private buildSandbox(tracker: OutputTracker): Record<string, unknown> {
    const makeLine = (args: unknown[]) => args.map(String).join(' ');

    const addLine = (line: string) => {
      if (tracker.truncated) {
        return;
      }

      if (tracker.lines.length >= MAX_OUTPUT_LINES || tracker.charCount + line.length > MAX_OUTPUT_CHARS) {
        tracker.truncated = true;
        tracker.truncatedAt = {
          lines: tracker.lines.length,
          chars: tracker.charCount,
        };
        return;
      }

      tracker.lines.push(line);
      tracker.charCount += line.length;
    };

    const consoleObj = {
      log: (...args: unknown[]) => {
        addLine(makeLine(args));
      },
      error: (...args: unknown[]) => {
        addLine('[ERROR] ' + makeLine(args));
      },
      warn: (...args: unknown[]) => {
        addLine('[WARN] ' + makeLine(args));
      },
      info: (...args: unknown[]) => {
        addLine('[INFO] ' + makeLine(args));
      },
    };

    const stdoutStub = {
      write: (chunk: unknown) => {
        addLine(String(chunk).replace(/\n$/, ''));
        return true;
      },
    };
    const stderrStub = {
      write: (chunk: unknown) => {
        addLine(String(chunk).replace(/\n$/, ''));
        return true;
      },
    };

    const sandbox: Record<string, unknown> = {
      console: consoleObj,
      require: (m: string) => this.safeRequire(m),
      process: { env: process.env, stdout: stdoutStub, stderr: stderrStub },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Promise,
      JSON,
      Buffer,
      Date,
      Math,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Error,
    };

    return sandbox;
  }

  /**
   * Execute TypeScript code in the sandbox.
   * @param code - TypeScript code to execute
   * @param timeoutMs - Execution timeout in milliseconds (default: 30000, max: 120000)
   */
  async execute(code: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
    const startTime = Date.now();
    const tracker: OutputTracker = {
      lines: [],
      charCount: 0,
      truncated: false,
    };

    const timeout = Math.min(Math.max(timeoutMs, 1000), 120000);

    try {
      await this.ensureAllowedModulesPreloaded();

      // 1. Convert import statements to require() calls so they work inside async IIFE
      const processedCode = convertImportsToRequires(code);

      // 2. Wrap in async IIFE for top-level await support
      const wrappedTs = `(async () => {\n${processedCode}\n})()`;

      // 3. Transform TypeScript to JavaScript
      const { code: jsCode } = await transform(wrappedTs, {
        loader: 'ts',
        format: 'cjs',
        target: 'es2022',
      });

      // 3. Create sandbox context with restricted require()
      const sandbox: Record<string, unknown> = this.buildSandbox(tracker);

      // 4. Create a promise that will be resolved when the async code completes
      let resolveResult: (value: unknown) => void;
      let rejectResult: (error: unknown) => void;
      const resultPromise = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });

      sandbox.__resolve__ = resolveResult!;
      sandbox.__reject__ = rejectResult!;

      const context = vm.createContext(sandbox);

      // 5. Wrap the transformed code to capture completion/errors
      const trimmedJsCode = jsCode.trim().replace(/;$/, '');
      const finalCode = `
        ${trimmedJsCode}
        .then(() => __resolve__(undefined))
        .catch((e) => __reject__(e));
      `;

      // 6. Execute in sandbox
      const script = new vm.Script(finalCode, {
        filename: 'sandbox-script.js',
      });

      script.runInContext(context);

      // Wait for the async code to complete with timeout
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Script execution timed out')), timeout);
      });

      try {
        await Promise.race([resultPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId!);
      }

      return {
        success: true,
        output: tracker.lines.join('\n'),
        executionTimeMs: Date.now() - startTime,
        outputLineCount: tracker.lines.length,
        outputCharCount: tracker.charCount,
        truncated: tracker.truncated,
        truncatedAt: tracker.truncatedAt,
      };

    } catch (error) {
      return {
        success: false,
        output: tracker.lines.join('\n'),
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime,
        outputLineCount: tracker.lines.length,
        outputCharCount: tracker.charCount,
        truncated: tracker.truncated,
        truncatedAt: tracker.truncatedAt,
      };
    }
  }
}
