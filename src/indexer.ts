import { LibraryIndexer, type PackageConfig } from '@prodisco/search-libs';
import type { ApilensConfig, ResolvedPaths } from './types.js';

let indexerInstance: LibraryIndexer | null = null;

/**
 * Get or create a LibraryIndexer, lazily initializing it.
 */
export async function getIndexer(
  config: ApilensConfig,
  resolvedPaths: ResolvedPaths,
  options: { verbose?: boolean } = {},
): Promise<LibraryIndexer> {
  if (indexerInstance?.isInitialized()) {
    return indexerInstance;
  }

  const packages: PackageConfig[] = config.libraries
    .filter((lib) => resolvedPaths.resolved.includes(lib.name))
    .map((lib) => ({ name: lib.name }));

  if (packages.length === 0) {
    throw new Error('No packages resolved. Check your config and ensure packages can be installed.');
  }

  indexerInstance = new LibraryIndexer({
    packages,
    basePath: resolvedPaths.basePaths,
  });

  if (options.verbose) {
    process.stderr.write(`Indexing ${packages.length} package(s)...\n`);
  }

  const result = await indexerInstance.initialize();

  if (options.verbose) {
    process.stderr.write(`Indexed ${result.indexed} items\n`);
    for (const [pkg, count] of Object.entries(result.packageCounts)) {
      process.stderr.write(`  ${pkg}: ${count}\n`);
    }
    if (result.errors.length > 0) {
      process.stderr.write(`  ${result.errors.length} extraction error(s)\n`);
    }
  }

  return indexerInstance;
}

/**
 * Shutdown the indexer if initialized.
 */
export async function shutdownIndexer(): Promise<void> {
  if (indexerInstance) {
    await indexerInstance.shutdown();
    indexerInstance = null;
  }
}
