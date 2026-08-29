import { chmod, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RaccoonState } from '../domain';
import { createInitialState, parseState } from './model';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 25;

export type StatePaths = {
  directory: string;
  stateFile: string;
  lockFile: string;
};

export type StateLoad = {
  state: RaccoonState;
  source: 'existing' | 'missing' | 'recovered';
};

export class StateStoreError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = 'StateStoreError';
  }
}

type LockRecord = { pid: number; createdAt: string; token: string };

export function defaultStatePaths(options: { testDirectory?: string } = {}): StatePaths {
  const directory = options.testDirectory ?? join(homedir(), 'Library', 'Application Support', 'Tibo Raccoon');
  return { directory, stateFile: join(directory, 'state.json'), lockFile: join(directory, 'state.lock') };
}

export async function loadState(paths: StatePaths): Promise<StateLoad> {
  await ensureDirectory(paths);
  const initial = await readState(paths);
  if (initial.kind === 'existing' && !(await recoveryMarkerExists(paths))) return { state: initial.state, source: 'existing' };
  if (initial.kind === 'missing' && !(await recoveryMarkerExists(paths))) return { state: createInitialState(), source: 'missing' };

  return withLock(paths, async () => {
    const current = await readState(paths);
    if (current.kind === 'existing') {
      await removeRecoveryMarker(paths);
      return { state: current.state, source: 'existing' as const };
    }
    if (current.kind === 'missing' && !(await recoveryMarkerExists(paths))) return { state: createInitialState(), source: 'missing' as const };
    if (current.kind === 'missing') {
      const state = createInitialState({ recoveryPending: true });
      await writeState(paths, state);
      await removeRecoveryMarker(paths);
      return { state, source: 'recovered' as const };
    }
    const state = await recoverCorruptState(paths);
    return { state, source: 'recovered' as const };
  });
}

export async function mutateState(
  paths: StatePaths,
  mutation: (current: RaccoonState) => RaccoonState,
): Promise<RaccoonState> {
  await ensureDirectory(paths);
  return withLock(paths, async () => {
    const loaded = await readState(paths);
    let current: RaccoonState;
    if (loaded.kind === 'existing') current = loaded.state;
    else if (loaded.kind === 'missing') {
      current = (await recoveryMarkerExists(paths)) ? createInitialState({ recoveryPending: true }) : createInitialState();
    }
    else current = await recoverCorruptState(paths);

    let next: RaccoonState;
    try {
      next = parseState(await mutation(current));
    } catch {
      throw new StateStoreError('State update could not be saved');
    }
    await writeState(paths, next);
    await removeRecoveryMarker(paths);
    return next;
  });
}

async function ensureDirectory(paths: StatePaths): Promise<void> {
  try {
    await mkdir(paths.directory, { recursive: true, mode: DIRECTORY_MODE });
    await chmod(paths.directory, DIRECTORY_MODE);
  } catch {
    throw new StateStoreError('Private state storage is unavailable');
  }
}

type ReadResult = { kind: 'existing'; state: RaccoonState } | { kind: 'missing' } | { kind: 'corrupt' };

async function readState(paths: StatePaths): Promise<ReadResult> {
  let body: string;
  try {
    body = await readFile(paths.stateFile, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' };
    throw new StateStoreError('Private state storage is unavailable');
  }
  try {
    return { kind: 'existing', state: parseState(JSON.parse(body)) };
  } catch {
    return { kind: 'corrupt' };
  }
}

async function recoverCorruptState(paths: StatePaths): Promise<RaccoonState> {
  await writeRecoveryMarker(paths);
  await quarantine(paths);
  const recovered = createInitialState({ recoveryPending: true });
  await writeState(paths, recovered);
  await removeRecoveryMarker(paths);
  return recovered;
}

function recoveryMarkerFile(paths: StatePaths): string { return `${paths.stateFile}.recovery`; }

async function recoveryMarkerExists(paths: StatePaths): Promise<boolean> {
  try { await stat(recoveryMarkerFile(paths)); return true; } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw new StateStoreError('Private state storage is unavailable');
  }
}

async function writeRecoveryMarker(paths: StatePaths): Promise<void> {
  const marker = recoveryMarkerFile(paths);
  const temporary = `${marker}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', FILE_MODE);
    await chmod(temporary, FILE_MODE);
    await handle.writeFile('recovery\n', 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, marker);
    await chmod(marker, FILE_MODE).catch(() => undefined);
  } catch {
    throw new StateStoreError('State recovery could not be saved');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function removeRecoveryMarker(paths: StatePaths): Promise<void> {
  await unlink(recoveryMarkerFile(paths)).catch(() => undefined);
}

async function quarantine(paths: StatePaths): Promise<void> {
  for (;;) {
    const target = join(paths.directory, `state.json.corrupt-${timestampForFilename(Date.now())}`);
    try {
      await stat(target);
      await Bun.sleep(1);
      continue;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw new StateStoreError('Private state storage is unavailable');
    }
    try {
      await rename(paths.stateFile, target);
      return;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw new StateStoreError('Private state storage is unavailable');
    }
  }
}

function timestampForFilename(now: number): string {
  return new Date(now).toISOString().replace(/[-:.]/g, '');
}

async function writeState(paths: StatePaths, state: RaccoonState): Promise<void> {
  const temporary = `${paths.stateFile}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', FILE_MODE);
    await chmod(temporary, FILE_MODE);
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, paths.stateFile);
    // The temporary was already private; rename is the durable commit boundary.
    await chmod(paths.stateFile, FILE_MODE).catch(() => undefined);
  } catch {
    throw new StateStoreError('State update could not be saved');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function withLock<T>(paths: StatePaths, operation: () => Promise<T>): Promise<T> {
  const owner = await acquireLock(paths);
  try {
    return await operation();
  } finally {
    await releaseLock(paths, owner);
  }
}

async function acquireLock(paths: StatePaths): Promise<LockRecord> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const owner: LockRecord = { pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
  for (;;) {
    if (await reclaimMarkerExists(paths)) {
      if (Date.now() >= deadline) throw new StateStoreError('State is temporarily busy');
      await Bun.sleep(LOCK_WAIT_MS);
      continue;
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    try {
      handle = await open(paths.lockFile, 'wx', FILE_MODE);
      created = true;
      await chmod(paths.lockFile, FILE_MODE);
      await handle.writeFile(JSON.stringify(owner), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      return owner;
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => undefined);
      if (created) await unlink(paths.lockFile).catch(() => undefined);
      if (errorCode(error) !== 'EEXIST') throw new StateStoreError('Private state storage is unavailable');
    }

    await reclaimStaleLock(paths);
    if (Date.now() >= deadline) throw new StateStoreError('State is temporarily busy');
    await Bun.sleep(Math.min(LOCK_WAIT_MS, Math.max(1, deadline - Date.now())));
  }
}

async function reclaimStaleLock(paths: StatePaths): Promise<void> {
  const claim = `${paths.lockFile}.reclaim`;
  let claimHandle: Awaited<ReturnType<typeof open>> | undefined;
  let claimed = false;
  try {
    claimHandle = await open(claim, 'wx', FILE_MODE);
    claimed = true;
    await chmod(claim, FILE_MODE);
    await claimHandle.writeFile(randomUUID(), 'utf8');
    await claimHandle.sync();
  } catch {
    if (claimHandle !== undefined) await claimHandle.close().catch(() => undefined);
    if (claimed) await unlink(claim).catch(() => undefined);
    return;
  }
  if (claimHandle !== undefined) await claimHandle.close().catch(() => undefined);
  try {
  let body: string;
  try { body = await readFile(paths.lockFile, 'utf8'); } catch { return; }
  const owner = parseLockRecord(body);
  if (owner === null || Date.now() - Date.parse(owner.createdAt) <= LOCK_STALE_MS || !ownerIsDead(owner.pid)) return;
  try {
    const latest = await readFile(paths.lockFile, 'utf8');
    if (parseLockRecord(latest)?.token === owner.token) await unlink(paths.lockFile);
  } catch {
    // Another contender or owner changed the lock. It is safe to retry acquisition.
  }
  } finally { await unlink(claim).catch(() => undefined); }
}

async function reclaimMarkerExists(paths: StatePaths): Promise<boolean> {
  try { await stat(`${paths.lockFile}.reclaim`); return true; } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw new StateStoreError('Private state storage is unavailable');
  }
}

function ownerIsDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === 'ESRCH';
  }
}

async function releaseLock(paths: StatePaths, owner: LockRecord): Promise<void> {
  try {
    const latest = parseLockRecord(await readFile(paths.lockFile, 'utf8'));
    if (latest?.token === owner.token) await unlink(paths.lockFile);
  } catch {
    // Failure to clean up is retried by later contenders; never remove an unknown owner's lock.
  }
}

function parseLockRecord(value: string): LockRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    const { pid, createdAt, token } = candidate;
    if (
      typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 ||
      typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)) ||
      typeof token !== 'string' || token.length === 0
    ) return null;
    return { pid, createdAt, token };
  } catch { return null; }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
