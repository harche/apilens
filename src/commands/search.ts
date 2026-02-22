import { QueryBuilder } from '@prodisco/search-libs';
import type { CLIArgs, ApilensConfig } from '../types.js';
import { resolvePackages } from '../resolver.js';
import { getIndexer, shutdownIndexer } from '../indexer.js';
import { formatSearchOutput, writeOutput, writeError } from '../output.js';

export async function searchCommand(args: CLIArgs, config: ApilensConfig): Promise<void> {
  // Build the search query
  const query = args.query || args.method;
  if (!query) {
    writeError('No search query provided. Use: apilens search <query> or -m <method>');
    process.exitCode = 1;
    return;
  }

  try {
    const resolvedPaths = await resolvePackages(config, {
      verbose: args.verbose,
      quiet: args.quiet,
    });

    if (resolvedPaths.failed.length > 0) {
      process.stderr.write(
        `Warning: Failed to resolve: ${resolvedPaths.failed.join(', ')}\n`,
      );
    }

    if (resolvedPaths.resolved.length === 0) {
      writeError('No packages could be resolved.');
      process.exitCode = 1;
      return;
    }

    const indexer = await getIndexer(config, resolvedPaths, {
      verbose: args.verbose,
    });

    // Build search options
    const builder = QueryBuilder.create().query(query).limit(args.limit).offset(args.offset);

    if (args.library) {
      builder.library(args.library);
    }

    if (args.type && args.type !== 'all') {
      builder.documentType(args.type as 'method' | 'type' | 'function' | 'script');
    }

    if (args.category) {
      builder.category(args.category);
    }

    const searchOptions = builder.build();
    const searchResult = await indexer.search(searchOptions);

    const output = formatSearchOutput(searchResult);
    writeOutput(output);

    await shutdownIndexer();
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
