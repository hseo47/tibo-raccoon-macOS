import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RaccoonState } from '../domain';
import { createInitialState, parseState } from './model';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 25;
// Bun forwards process.kill PIDs to a signed pid_t. Values outside this range
// cannot be probed and are therefore malformed owner records.
const MAX_PROCESS_ID = 0x7fff_ffff;

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
  const verifiedPaths = await ensureDirectory(paths);
  const initial = await readState(verifiedPaths);
  if (initial.kind === 'existing' && !(await recoveryMarkerExists(verifiedPaths))) return { state: initial.state, source: 'existing' };
  if (initial.kind === 'missing' && !(await recoveryMarkerExists(verifiedPaths))) return { state: createInitialState(), source: 'missing' };

  return withLock(verifiedPaths, async () => {
    const current = await readState(verifiedPaths);
    if (current.kind === 'existing') {
      await removeRecoveryMarker(verifiedPaths);
      return { state: current.state, source: 'existing' as const };
    }
    if (current.kind === 'missing' && !(await recoveryMarkerExists(verifiedPaths))) return { state: createInitialState(), source: 'missing' as const };
    if (current.kind === 'missing') {
      const state = createInitialState({ recoveryPending: true });
      await writeState(verifiedPaths, state);
      await removeRecoveryMarker(verifiedPaths);
      return { state, source: 'recovered' as const };
    }
    const state = await recoverCorruptState(verifiedPaths);
    return { state, source: 'recovered' as const };
  });
}

export async function mutateState(
  paths: StatePaths,
  mutation: (current: RaccoonState) => RaccoonState,
): Promise<RaccoonState> {
  const verifiedPaths = await ensureDirectory(paths);
  return withLock(verifiedPaths, async () => {
    const loaded = await readState(verifiedPaths);
    let current: RaccoonState;
    if (loaded.kind === 'existing') current = loaded.state;
    else if (loaded.kind === 'missing') {
      current = (await recoveryMarkerExists(verifiedPaths)) ? createInitialState({ recoveryPending: true }) : createInitialState();
    }
    else current = await recoverCorruptState(verifiedPaths);

    let next: RaccoonState;
    try {
      next = parseState(await mutation(current));
    } catch {
      throw new StateStoreError('State update could not be saved');
    }
    await writeState(verifiedPaths, next);
    await removeRecoveryMarker(verifiedPaths);
    return next;
  });
}

async function ensureDirectory(paths: StatePaths): Promise<StatePaths> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(paths.directory, { recursive: true, mode: DIRECTORY_MODE });
    const entry = await lstat(paths.directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('unsafe state directory');
    handle = await open(paths.directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isDirectory() || opened.dev !== entry.dev || opened.ino !== entry.ino) throw new Error('state directory changed');
    await handle.chmod(DIRECTORY_MODE);
    const directory = await realpath(paths.directory);
    const latest = await lstat(paths.directory);
    if (latest.isSymbolicLink() || !latest.isDirectory() || latest.dev !== entry.dev || latest.ino !== entry.ino) throw new Error('state directory changed');
    return defaultStatePaths({ testDirectory: directory });
  } catch {
    throw new StateStoreError('Private state storage is unavailable');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

type Artifact = {
  kind: 'regular' | 'unsupported';
  body: string | null;
  modifiedAt: number;
  dev: number;
  ino: number;
};

async function inspectArtifact(path: string): Promise<Artifact | { kind: 'missing' }> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try { entry = await lstat(path); } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  const identity = { modifiedAt: entry.mtimeMs, dev: entry.dev, ino: entry.ino };
  if (!entry.isFile() || entry.isSymbolicLink()) return { kind: 'unsupported', body: null, ...identity };

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) throw new Error('artifact changed');
    return { kind: 'regular', body: await handle.readFile('utf8'), ...identity };
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

type ReadResult = { kind: 'existing'; state: RaccoonState } | { kind: 'missing' } | { kind: 'corrupt' };

async function readState(paths: StatePaths): Promise<ReadResult> {
  try {
    const artifact = await inspectArtifact(paths.stateFile);
    if (artifact.kind === 'missing') return { kind: 'missing' };
    if (artifact.kind !== 'regular' || artifact.body === null) throw new Error('unsafe state artifact');
    try {
      return { kind: 'existing', state: parseState(JSON.parse(artifact.body)) };
    } catch {
      return { kind: 'corrupt' };
    }
  } catch (error) {
    throw new StateStoreError('Private state storage is unavailable');
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
  try {
    const artifact = await inspectArtifact(recoveryMarkerFile(paths));
    if (artifact.kind === 'missing') return false;
    if (artifact.kind !== 'regular') throw new Error('unsafe recovery marker');
    return true;
  } catch {
    throw new StateStoreError('Private state storage is unavailable');
  }
}

async function writeRecoveryMarker(paths: StatePaths): Promise<void> {
  const marker = recoveryMarkerFile(paths);
  const temporary = `${marker}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', FILE_MODE);
    await handle.chmod(FILE_MODE);
    await handle.writeFile('recovery\n', 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, marker);
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
      await lstat(target);
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
    await handle.chmod(FILE_MODE);
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, paths.stateFile);
    // The private temporary and same-directory rename are the durable commit boundary.
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
  await cleanupOwnerTemporaries(paths);
  for (;;) {
    await recoverStaleReclaimClaim(paths);
    if (await artifactExists(reclaimMarkerFile(paths))) {
      if (Date.now() >= deadline) throw new StateStoreError('State is temporarily busy');
      await Bun.sleep(LOCK_WAIT_MS);
      continue;
    }
    const owner: LockRecord = { pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
    try {
      if (await publishOwnerRecord(paths.lockFile, owner)) return owner;
    } catch (error) {
      throw new StateStoreError('Private state storage is unavailable');
    }

    await reclaimStaleLock(paths);
    if (Date.now() >= deadline) throw new StateStoreError('State is temporarily busy');
    await Bun.sleep(Math.min(LOCK_WAIT_MS, Math.max(1, deadline - Date.now())));
  }
}

async function reclaimStaleLock(paths: StatePaths): Promise<void> {
  const claim = reclaimMarkerFile(paths);
  const claimant: LockRecord = { pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
  try {
    if (!(await publishOwnerRecord(claim, claimant))) {
      await recoverStaleReclaimClaim(paths);
      return;
    }
  } catch {
    return;
  }
  try {
    const artifact = await inspectArtifact(paths.lockFile);
    await recoverOwnedArtifact(paths.lockFile, artifact);
  } catch {
    // The primary changed while the reclaim claim was held. A later contender retries safely.
  } finally {
    await unlinkOwnedArtifact(claim, claimant);
  }
}

function reclaimMarkerFile(paths: StatePaths): string {
  return `${paths.lockFile}.reclaim`;
}

async function recoverStaleReclaimClaim(paths: StatePaths): Promise<void> {
  const claim = reclaimMarkerFile(paths);
  let artifact: Awaited<ReturnType<typeof inspectArtifact>>;
  try { artifact = await inspectArtifact(claim); } catch { throw new StateStoreError('Private state storage is unavailable'); }
  await recoverOwnedArtifact(claim, artifact);
}

async function recoverOwnedArtifact(
  path: string,
  artifact: Awaited<ReturnType<typeof inspectArtifact>>,
): Promise<void> {
  if (artifact.kind === 'missing') return;
  const owner = artifact.kind === 'regular' && artifact.body !== null ? parseLockRecord(artifact.body) : null;
  if (owner === null) {
    if (artifactIsStale(artifact)) await preserveAndDisplace(path, artifact);
    return;
  }
  if (recordIsMateriallyFuture(owner)) {
    if (artifactIsStale(artifact) && ownerIsDead(owner.pid)) await preserveAndDisplace(path, artifact);
    return;
  }
  if (recordIsStale(owner) && ownerIsDead(owner.pid)) await unlinkOwnedArtifact(path, owner);
}

async function publishOwnerRecord(path: string, owner: LockRecord): Promise<boolean> {
  const temporary = `${path}.owner-${owner.token}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', FILE_MODE);
    await handle.chmod(FILE_MODE);
    await handle.writeFile(JSON.stringify(owner), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return false;
      throw error;
    }
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function artifactExists(path: string): Promise<boolean> {
  try { return (await inspectArtifact(path)).kind !== 'missing'; } catch { throw new StateStoreError('Private state storage is unavailable'); }
}

async function unlinkOwnedArtifact(path: string, owner: LockRecord): Promise<void> {
  try {
    const latest = await inspectArtifact(path);
    if (latest.kind === 'regular' && latest.body !== null && parseLockRecord(latest.body)?.token === owner.token) await unlink(path);
  } catch {
    // Never remove an artifact whose current complete owner record is unknown.
  }
}

async function preserveAndDisplace(path: string, artifact: Artifact): Promise<void> {
  const latest = await lstat(path);
  if (latest.dev !== artifact.dev || latest.ino !== artifact.ino) return;
  await rename(path, `${path}.orphan-${randomUUID()}`);
}

async function cleanupOwnerTemporaries(paths: StatePaths): Promise<void> {
  const lockName = basename(paths.lockFile);
  const ownerTemporary = new RegExp(`^${lockName.replace('.', '\\.')}(?:\\.reclaim)?\\.owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'i');
  let entries: string[];
  try { entries = await readdir(paths.directory); } catch { throw new StateStoreError('Private state storage is unavailable'); }
  for (const entry of entries) {
    if (!ownerTemporary.test(entry)) continue;
    const path = join(paths.directory, entry);
    try {
      const artifact = await inspectArtifact(path);
      if (artifact.kind !== 'regular' || Date.now() - artifact.modifiedAt <= LOCK_STALE_MS) continue;
      const owner = artifact.body === null ? null : parseLockRecord(artifact.body);
      if (owner !== null && !ownerIsDead(owner.pid)) continue;
      await unlink(path);
    } catch {
      // Narrow owner temporaries never block acquisition, so cleanup remains best effort.
    }
  }
}

function recordIsStale(owner: LockRecord): boolean {
  return Date.now() - Date.parse(owner.createdAt) > LOCK_STALE_MS;
}

function recordIsMateriallyFuture(owner: LockRecord): boolean {
  return Date.parse(owner.createdAt) - Date.now() > LOCK_STALE_MS;
}

function artifactIsStale(artifact: Artifact): boolean {
  return Date.now() - artifact.modifiedAt > LOCK_STALE_MS;
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
  await unlinkOwnedArtifact(paths.lockFile, owner);
}

function parseLockRecord(value: string): LockRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    const { pid, createdAt, token } = candidate;
    if (
      typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid > MAX_PROCESS_ID ||
      typeof createdAt !== 'string' || parseCanonicalLockTimestamp(createdAt) === null ||
      typeof token !== 'string' || token.length === 0
    ) return null;
    return { pid, createdAt, token };
  } catch { return null; }
}

function parseCanonicalLockTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  return timestamp;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
