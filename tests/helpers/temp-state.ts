import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { StatePaths } from '../../src/state/store';

const PREFIX = 'tibo-raccoon-state-';

export async function tempStatePaths(): Promise<StatePaths> {
  const directory = await mkdtemp(join(tmpdir(), PREFIX));
  return { directory, stateFile: join(directory, 'state.json'), lockFile: join(directory, 'state.lock') };
}

export async function cleanupTempState(paths: StatePaths): Promise<void> {
  if (dirname(paths.directory) !== tmpdir() || !basename(paths.directory).startsWith(PREFIX)) {
    throw new Error('Refusing to clean a non-test state directory');
  }
  await rm(paths.directory, { recursive: true, force: true });
}
