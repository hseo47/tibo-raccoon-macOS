import { afterEach, describe, expect, test } from 'bun:test';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RaccoonState } from '../src/domain';
import { defaultStatePaths, loadState, mutateState, StateStoreError } from '../src/state/store';
import { createInitialState } from '../src/state/model';
import { cleanupTempState, tempStatePaths } from './helpers/temp-state';

const pathsToClean: Array<Awaited<ReturnType<typeof tempStatePaths>>> = [];
async function paths(): Promise<Awaited<ReturnType<typeof tempStatePaths>>> { const value = await tempStatePaths(); pathsToClean.push(value); return value; }
async function mode(path: string): Promise<number> { return (await stat(path)).mode & 0o777; }
function lockRecord(pid: number, createdAt: string, token = 'test-owner'): string { return JSON.stringify({ pid, createdAt, token }); }

afterEach(async () => { await Promise.all(pathsToClean.splice(0).map(cleanupTempState)); });

describe('private state paths and writes', () => {
  test('constructs the exact production state path without creating it', () => {
    const directory = join(homedir(), 'Library', 'Application Support', 'Tibo Raccoon');
    expect(defaultStatePaths()).toEqual({ directory, stateFile: join(directory, 'state.json'), lockFile: join(directory, 'state.lock') });
  });

  test('creates a private directory and reports missing state', async () => {
    const statePaths = await paths(); const loaded = await loadState(statePaths);
    expect(loaded).toEqual({ state: createInitialState(), source: 'missing' });
    expect(await mode(statePaths.directory)).toBe(0o700);
    await expect(stat(statePaths.stateFile)).rejects.toThrow();
  });

  test('atomically writes private state and leaves no temporary or lock files', async () => {
    const statePaths = await paths(); let start!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; }); const finish = new Promise<void>((resolve) => { release = resolve; });
    const mutation = mutateState(statePaths, (async (current: RaccoonState) => { start(); await finish; return { ...current, knownIds: ['persisted'] }; }) as unknown as (current: RaccoonState) => RaccoonState);
    await started; expect(await mode(statePaths.lockFile)).toBe(0o600); release(); await mutation;
    expect(await mode(statePaths.stateFile)).toBe(0o600);
    expect((await readdir(statePaths.directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    await expect(stat(statePaths.lockFile)).rejects.toThrow();
    expect((await loadState(statePaths)).state.knownIds).toEqual(['persisted']);
  });
});

describe('corrupt state recovery', () => {
  test('resumes unread-first recovery after an interruption following quarantine', async () => {
    const statePaths = await paths();
    await loadState(statePaths);
    await writeFile(join(statePaths.directory, 'state.json.recovery'), 'recovery\n', { mode: 0o600 });
    const loaded = await loadState(statePaths);
    expect(loaded).toEqual({ state: createInitialState({ recoveryPending: true }), source: 'recovered' });
    expect((await loadState(statePaths)).state.recoveryPending).toBe(true);
    await expect(stat(join(statePaths.directory, 'state.json.recovery'))).rejects.toThrow();
  });

  test('quarantines invalid JSON and persists unread-first recovery', async () => {
    const statePaths = await paths(); await writeFile(statePaths.stateFile, '{not-json', { mode: 0o600 });
    const loaded = await loadState(statePaths); const quarantines = (await readdir(statePaths.directory)).filter((name) => /^state\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(loaded.source).toBe('recovered'); expect(loaded.state.recoveryPending).toBe(true); expect(await mode(statePaths.stateFile)).toBe(0o600); expect(quarantines).toHaveLength(1); expect(await readFile(statePaths.stateFile, 'utf8')).not.toContain('{not-json');
    expect((await loadState(statePaths)).state.recoveryPending).toBe(true);
  });

  test('quarantines unsupported versions without deleting their bytes', async () => {
    const statePaths = await paths(); const unsupported = JSON.stringify({ ...createInitialState(), version: 2 }); await writeFile(statePaths.stateFile, unsupported, { mode: 0o600 });
    const loaded = await loadState(statePaths); const quarantines = (await readdir(statePaths.directory)).filter((name) => /^state\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(loaded.state.recoveryPending).toBe(true); expect(quarantines).toHaveLength(1); expect(await readFile(join(statePaths.directory, quarantines[0]!), 'utf8')).toBe(unsupported);
  });
});

describe('owner-aware locking', () => {
  test('serializes two writers without losing either update', async () => {
    const statePaths = await paths(); await Promise.all([
      mutateState(statePaths, (current) => ({ ...current, knownIds: [...current.knownIds, 'one'] })),
      mutateState(statePaths, (current) => ({ ...current, knownIds: [...current.knownIds, 'two'] })),
    ]); expect((await loadState(statePaths)).state.knownIds).toEqual(['one', 'two']);
  });
  test('does not steal a live owner lock', async () => {
    const statePaths = await paths(); await writeFile(statePaths.lockFile, lockRecord(process.pid, new Date(Date.now() - 31_000).toISOString()), { mode: 0o600 }); const started = Date.now();
    await expect(mutateState(statePaths, (current) => current)).rejects.toBeInstanceOf(StateStoreError); expect(Date.now() - started).toBeGreaterThanOrEqual(1_900); await expect(stat(statePaths.stateFile)).rejects.toThrow();
  });
  test('treats EPERM ownership probes as alive', async () => {
    const statePaths = await paths(); await writeFile(statePaths.lockFile, lockRecord(999_999, new Date(Date.now() - 31_000).toISOString()), { mode: 0o600 });
    const originalKill = process.kill; process.kill = (() => { throw Object.assign(new Error(), { code: 'EPERM' }); }) as typeof process.kill;
    try { await expect(mutateState(statePaths, (current) => current)).rejects.toBeInstanceOf(StateStoreError); } finally { process.kill = originalKill; }
    await expect(stat(statePaths.stateFile)).rejects.toThrow();
  });
  test('reclaims a dead owner lock older than thirty seconds', async () => {
    const statePaths = await paths(); await writeFile(statePaths.lockFile, lockRecord(999_999, new Date(Date.now() - 31_000).toISOString()), { mode: 0o600 });
    expect((await mutateState(statePaths, (current) => ({ ...current, knownIds: ['reclaimed'] }))).knownIds).toEqual(['reclaimed']); await expect(stat(statePaths.lockFile)).rejects.toThrow();
  });
  test('does not reclaim a non-stale dead-owner lock', async () => {
    const statePaths = await paths(); await writeFile(statePaths.lockFile, lockRecord(999_999, new Date().toISOString()), { mode: 0o600 });
    await expect(mutateState(statePaths, (current) => current)).rejects.toBeInstanceOf(StateStoreError); await expect(stat(statePaths.stateFile)).rejects.toThrow();
  });
  test('times out after two seconds without changing state', async () => {
    const statePaths = await paths(); await mutateState(statePaths, (current) => ({ ...current, knownIds: ['before'] })); await writeFile(statePaths.lockFile, lockRecord(process.pid, new Date().toISOString()), { mode: 0o600 }); const started = Date.now();
    await expect(mutateState(statePaths, (current) => ({ ...current, knownIds: ['after'] }))).rejects.toBeInstanceOf(StateStoreError); expect(Date.now() - started).toBeGreaterThanOrEqual(1_900); expect(Date.now() - started).toBeLessThan(2_500); expect((await loadState(statePaths)).state.knownIds).toEqual(['before']);
  });
  test('serializes simultaneous stale reclaimers without losing updates', async () => {
    const statePaths = await paths(); await writeFile(statePaths.lockFile, lockRecord(999_999, new Date(Date.now() - 31_000).toISOString()), { mode: 0o600 });
    await Promise.all([
      mutateState(statePaths, (current) => ({ ...current, knownIds: [...current.knownIds, 'stale-one'] })),
      mutateState(statePaths, (current) => ({ ...current, knownIds: [...current.knownIds, 'stale-two'] })),
    ]);
    expect((await loadState(statePaths)).state.knownIds).toEqual(['stale-one', 'stale-two']);
    expect((await readdir(statePaths.directory)).filter((name) => name.includes('.reclaim'))).toEqual([]);
  });
  test('does not remove a replacement lock owned by another token', async () => {
    const statePaths = await paths(); let replace!: () => void; let finish!: () => void; const ready = new Promise<void>((resolve) => { replace = resolve; }); const allowed = new Promise<void>((resolve) => { finish = resolve; });
    const mutation = mutateState(statePaths, (async (current: RaccoonState) => { replace(); await allowed; return current; }) as unknown as (current: RaccoonState) => RaccoonState); await ready; await writeFile(statePaths.lockFile, lockRecord(process.pid, new Date().toISOString(), 'replacement-token'), { mode: 0o600 }); finish(); await mutation;
    expect(JSON.parse(await readFile(statePaths.lockFile, 'utf8')).token).toBe('replacement-token'); await unlink(statePaths.lockFile);
  });
});
