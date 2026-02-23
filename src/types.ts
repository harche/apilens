export interface CLIArgs {
  /** The command to execute */
  command: string;

  /** Positional arguments after the command */
  positional: string[];

  /** Path to config file */
  config?: string;

  /** Debug output on stderr */
  verbose: boolean;

  /** Suppress stderr */
  quiet: boolean;

  /** Show help */
  help: boolean;

  /** Show version */
  version: boolean;

  /** Install skill files (for install command) */
  skills: boolean;

  /** Execution timeout in milliseconds (for exec command) */
  timeout: number;

  /** Custom output directory for skill files (for install --skills) */
  dir?: string;
}

export interface LibrarySpec {
  /** npm package name */
  name: string;

  /** One-line human-readable title for the SKILL.md description */
  title: string;

  /** Optional detailed description for per-library reference files */
  description?: string;
}

export interface ApilensConfig {
  libraries: LibrarySpec[];
}

export interface ResolvedPaths {
  /** Base paths where node_modules can be found */
  basePaths: string[];

  /** Libraries that were resolved */
  resolved: string[];

  /** Libraries that failed to resolve */
  failed: string[];
}
