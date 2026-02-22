import { formatResults, type FormattedResult, type FormatOptions } from '@prodisco/search-libs';
import type { SearchResult, BaseDocument } from '@prodisco/search-libs';

export interface CLIOutput {
  summary: string;
  results: FormattedResult['items'];
  totalMatches: number;
  facets: FormattedResult['facets'];
  pagination: FormattedResult['pagination'];
  searchTimeMs: number;
}

/**
 * Format search results into the CLI JSON output schema.
 */
export function formatSearchOutput(
  searchResult: SearchResult<BaseDocument>,
  options: FormatOptions = {},
): CLIOutput {
  const formatted = formatResults(searchResult, options);

  return {
    summary: formatted.summary,
    results: formatted.items,
    totalMatches: formatted.totalMatches,
    facets: formatted.facets,
    pagination: formatted.pagination,
    searchTimeMs: Math.round(formatted.searchTime * 100) / 100,
  };
}

/**
 * Write JSON output to stdout.
 */
export function writeOutput(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Write an error response to stdout as JSON.
 */
export function writeError(message: string): void {
  writeOutput({ error: message });
}
