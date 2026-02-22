import type { CLIArgs, ApilensConfig } from '../types.js';
import { writeOutput } from '../output.js';

export async function listCommand(_args: CLIArgs, config: ApilensConfig): Promise<void> {
  const libraries = config.libraries.map((lib) => ({
    name: lib.name,
    description: lib.description ?? null,
  }));

  writeOutput({
    libraries,
    count: libraries.length,
  });
}
