import type { CLIArgs, ApilensConfig } from '../types.js';
import { resolvePackages } from '../resolver.js';
import { getIndexer, shutdownIndexer } from '../indexer.js';
import { writeOutput, writeError } from '../output.js';

export async function indexCommand(args: CLIArgs, config: ApilensConfig): Promise<void> {
  try {
    const resolvedPaths = await resolvePackages(config, {
      verbose: args.verbose,
      quiet: args.quiet,
    });

    if (resolvedPaths.failed.length > 0 && !args.quiet) {
      process.stderr.write(
        `Warning: Failed to resolve: ${resolvedPaths.failed.join(', ')}\n`,
      );
    }

    if (resolvedPaths.resolved.length === 0) {
      writeError('No packages could be resolved.');
      process.exitCode = 1;
      return;
    }

    if (!args.quiet) {
      process.stderr.write('Building search index...\n');
    }

    const indexer = await getIndexer(config, resolvedPaths, {
      verbose: args.verbose,
    });

    // Get a search with no query to show total indexed counts
    const result = await indexer.search({ query: '', limit: 0 });

    writeOutput({
      message: 'Index built successfully',
      totalDocuments: result.totalMatches,
      facets: result.facets,
    });

    await shutdownIndexer();
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
