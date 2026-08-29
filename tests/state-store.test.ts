import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, lstat, mkdir, readdir, readFile, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
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
async function faultChild(statePaths: Awaited<ReturnType<typeof tempStatePaths>>, fault: string): Promise<{ threw: boolean; fired: boolean; quarantined: boolean; renamed: boolean }> {
  const child = Bun.spawn([process.execPath, join(process.cwd(), 'tests/helpers/state-store-fault-child.ts'), fault, statePaths.directory]);
  expect(await child.exited).toBe(0);
  return JSON.parse(await readFile(join(statePaths.directory, 'fault-result.json'), 'utf8'));
}
async function waitFor(path: string): Promise<void> { for (let i = 0; i < 200; i += 1) { try { await stat(path); return; } catch { await Bun.sleep(5); } } throw new Error('fault child did not signal'); }
async function ageLockArtifacts(directory: string): Promise<void> {
  const stale = new Date(Date.now() - 31_000);
  for (const name of await readdir(directory)) {
    if (!name.startsWith('state.lock')) continue;
    const path = join(directory, name);
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      if (typeof parsed.createdAt === 'string') await writeFile(path, JSON.stringify({ ...parsed, createdAt: stale.toISOString() }));
    } catch {
      // Incomplete and legacy crash residue is aged by metadata alone.
    }
    await utimes(path, stale, stale);
  }
}

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

  test('rejects a symlinked production-shaped state root without touching its target', async () => {
    const root = await paths();
    const target = join(root.directory, 'unrelated-target');
    const stateDirectory = join(root.directory, 'Tibo Raccoon');
    const sentinel = join(target, 'sentinel.txt');
    await mkdir(target, { mode: 0o755 });
    await chmod(target, 0o755);
    await writeFile(sentinel, 'unchanged\n', { mode: 0o644 });
    await symlink(target, stateDirectory);
    const redirected = defaultStatePaths({ testDirectory: stateDirectory });

    await expect(mutateState(redirected, (current) => ({ ...current, knownIds: ['must-not-write'] }))).rejects.toBeInstanceOf(StateStoreError);

    expect((await stat(target)).mode & 0o777).toBe(0o755);
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged\n');
    await expect(lstat(join(target, 'state.json'))).rejects.toThrow();
    expect((await lstat(stateDirectory)).isSymbolicLink()).toBe(true);
  });

  test('rejects a symlinked state artifact without reading or replacing its target', async () => {
    const statePaths = await paths();
    const target = join(statePaths.directory, 'unrelated-state.json');
    const content = `${JSON.stringify(createInitialState())}\n`;
    await writeFile(target, content, { mode: 0o644 });
    await symlink(target, statePaths.stateFile);

    await expect(loadState(statePaths)).rejects.toBeInstanceOf(StateStoreError);

    expect(await readFile(target, 'utf8')).toBe(content);
    expect((await stat(target)).mode & 0o777).toBe(0o644);
    expect((await lstat(statePaths.stateFile)).isSymbolicLink()).toBe(true);
  });

  test('rejects a non-directory state root without changing its bytes or mode', async () => {
    const root = await paths();
    const stateDirectory = join(root.directory, 'Tibo Raccoon');
    await writeFile(stateDirectory, 'not a directory\n', { mode: 0o644 });
    const redirected = defaultStatePaths({ testDirectory: stateDirectory });

    await expect(loadState(redirected)).rejects.toBeInstanceOf(StateStoreError);

    expect(await readFile(stateDirectory, 'utf8')).toBe('not a directory\n');
    expect((await stat(stateDirectory)).mode & 0o777).toBe(0o644);
  });

  test('atomically writes private state and leaves no temporary or lock files', async () => {
    const statePaths = await paths(); let start!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; }); const finish = new Promise<void>((resolve) => { release = resolve; });
    const mutation = mutateState(statePaths, (async (current: RaccoonState) => { start(); await finish; return { ...current, knownIds: ['persisted'] }; }) as unknown as (current: RaccoonState) => RaccoonState);
    await started;
    expect(await mode(statePaths.lockFile)).toBe(0o600);
    const visibleOwner = JSON.parse(await readFile(statePaths.lockFile, 'utf8')) as Record<string, unknown>;
    expect(visibleOwner).toEqual({ pid: process.pid, createdAt: expect.any(String), token: expect.any(String) });
    release(); await mutation;
    expect(await mode(statePaths.stateFile)).toBe(0o600);
    expect((await readdir(statePaths.directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    await expect(stat(statePaths.lockFile)).rejects.toThrow();
    expect((await loadState(statePaths)).state.knownIds).toEqual(['persisted']);
  });
});

describe('isolated filesystem fault handling', () => {
  for (const fault of ['lock-write', 'lock-sync', 'lock-close']) {
    test(`cleans its created lock after ${fault} fails`, async () => {
      const statePaths = await paths(); const result = await faultChild(statePaths, fault);
      expect(result).toMatchObject({ threw: true, fired: true });
      expect((await readdir(statePaths.directory)).filter((name) => name === 'state.lock' || name.includes('.reclaim') || name.includes('.tmp-'))).toEqual([]);
      expect((await mutateState(statePaths, (current) => ({ ...current, knownIds: ['later'] }))).knownIds).toEqual(['later']);
    });
  }

  test('keeps the old state and cleans its temporary when rename is interrupted', async () => {
    const statePaths = await paths(); const result = await faultChild(statePaths, 'before-rename');
    expect(result).toMatchObject({ threw: true, fired: true, renamed: false });
    expect((await loadState(statePaths)).state.knownIds).toEqual(['old']);
    expect((await readdir(statePaths.directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    expect((await mutateState(statePaths, (current) => ({ ...current, knownIds: ['later'] }))).knownIds).toEqual(['later']);
  });

  test('keeps the committed state when post-rename chmod fails', async () => {
    const statePaths = await paths(); const result = await faultChild(statePaths, 'post-rename-chmod');
    expect(result).toMatchObject({ threw: false, fired: false, renamed: true });
    expect((await loadState(statePaths)).state.knownIds).toEqual(['new']);
    expect(await mode(statePaths.stateFile)).toBe(0o600);
  });

  test('observes a private same-directory temporary before rename', async () => {
    const statePaths = await paths(); const child = Bun.spawn([process.execPath, join(process.cwd(), 'tests/helpers/state-store-fault-child.ts'), 'observe-temp', statePaths.directory]);
    await waitFor(join(statePaths.directory, 'temp-ready'));
    const temporary = (await readdir(statePaths.directory)).find((name) => name.startsWith('state.json.tmp-'));
    expect(temporary).toBeDefined(); expect(await mode(join(statePaths.directory, temporary!))).toBe(0o600);
    await writeFile(join(statePaths.directory, 'temp-release'), 'release'); expect(await child.exited).toBe(0);
    expect((await loadState(statePaths)).state.knownIds).toEqual(['new']); expect((await readdir(statePaths.directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  test('resumes durable recovery after replacement fails following quarantine', async () => {
    const statePaths = await paths(); const result = await faultChild(statePaths, 'recovery-after-quarantine');
    expect(result).toMatchObject({ threw: true, fired: true, quarantined: true });
    const quarantines = (await readdir(statePaths.directory)).filter((name) => /^state\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(quarantines).toHaveLength(1); expect(await readFile(join(statePaths.directory, quarantines[0]!), 'utf8')).toBe('{broken');
    const recovered = await loadState(statePaths); expect(recovered).toEqual({ state: createInitialState({ recoveryPending: true }), source: 'recovered' });
    expect((await loadState(statePaths)).state.recoveryPending).toBe(true); await expect(stat(join(statePaths.directory, 'state.json.recovery'))).rejects.toThrow();
  });

  test('keeps unread-first recovery when direct mutation follows failed replacement', async () => {
    const statePaths = await paths(); const fault = await faultChild(statePaths, 'recovery-after-quarantine');
    expect(fault).toMatchObject({ threw: true, fired: true, quarantined: true });
    const mutated = await mutateState(statePaths, (current) => ({ ...current, knownIds: ['after-fault'] }));
    expect(mutated.recoveryPending).toBe(true); expect(mutated.knownIds).toEqual(['after-fault']);
    expect((await loadState(statePaths)).state.recoveryPending).toBe(true);
    await expect(stat(join(statePaths.directory, 'state.json.recovery'))).rejects.toThrow();
    const quarantines = (await readdir(statePaths.directory)).filter((name) => /^state\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(await readFile(join(statePaths.directory, quarantines[0]!), 'utf8')).toBe('{broken');
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
    const script = `process.kill=()=>{throw Object.assign(new Error(),{code:'EPERM'})};const m=await import(${JSON.stringify(join(process.cwd(), 'src/state/store.ts'))});try{await m.mutateState({directory:process.argv[1],stateFile:process.argv[1]+'/state.json',lockFile:process.argv[1]+'/state.lock'},x=>x);process.exit(1)}catch(e){process.exit(e.name==='StateStoreError'?0:2)}`;
    const child = Bun.spawn([process.execPath, '-e', script, statePaths.directory]);
    expect(await child.exited).toBe(0);
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
  test('does not remove a live-owner reclaim claim even when its timestamp is old', async () => {
    const statePaths = await paths();
    const claim = `${statePaths.lockFile}.reclaim`;
    await writeFile(claim, lockRecord(process.pid, new Date(Date.now() - 31_000).toISOString(), 'live-claim'), { mode: 0o600 });

    await expect(mutateState(statePaths, (current) => current)).rejects.toBeInstanceOf(StateStoreError);

    expect(JSON.parse(await readFile(claim, 'utf8')).token).toBe('live-claim');
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
  test('recovers an incomplete primary lock left by an abrupt process exit', async () => {
    const statePaths = await paths();
    const child = Bun.spawn([process.execPath, join(process.cwd(), 'tests/helpers/state-store-fault-child.ts'), 'crash-primary-create', statePaths.directory]);
    expect(await child.exited).toBe(86);
    await ageLockArtifacts(statePaths.directory);

    const recovered = await mutateState(statePaths, (current) => ({ ...current, knownIds: ['automatic'] }));

    expect(recovered.knownIds).toEqual(['automatic']);
    expect((await readdir(statePaths.directory)).filter((name) => name.startsWith('state.lock'))).toEqual([]);
  });
  test('preserves displaced malformed legacy lock bytes while recovering automatically', async () => {
    const statePaths = await paths();
    await writeFile(statePaths.lockFile, 'legacy-incomplete-owner', { mode: 0o600 });
    await ageLockArtifacts(statePaths.directory);

    const recovered = await mutateState(statePaths, (current) => ({ ...current, knownIds: ['legacy-recovered'] }));
    const orphan = (await readdir(statePaths.directory)).find((entry) => /^state\.lock\.orphan-[0-9a-f-]{36}$/i.test(entry));

    expect(recovered.knownIds).toEqual(['legacy-recovered']);
    expect(orphan).toBeDefined();
    expect(await readFile(join(statePaths.directory, orphan!), 'utf8')).toBe('legacy-incomplete-owner');
  });
  test('recovers a leaked reclaim claim after its owner dies and it becomes stale', async () => {
    const statePaths = await paths();
    await writeFile(statePaths.lockFile, lockRecord(999_999, new Date(Date.now() - 31_000).toISOString()), { mode: 0o600 });
    const child = Bun.spawn([process.execPath, join(process.cwd(), 'tests/helpers/state-store-fault-child.ts'), 'crash-reclaim-claim', statePaths.directory]);
    expect(await child.exited).toBe(87);
    const leakedClaim = JSON.parse(await readFile(`${statePaths.lockFile}.reclaim`, 'utf8')) as Record<string, unknown>;
    expect(leakedClaim).toEqual({ pid: expect.any(Number), createdAt: expect.any(String), token: expect.any(String) });
    expect(await mode(`${statePaths.lockFile}.reclaim`)).toBe(0o600);
    await ageLockArtifacts(statePaths.directory);

    const recovered = await mutateState(statePaths, (current) => ({ ...current, knownIds: ['automatic'] }));

    expect(recovered.knownIds).toEqual(['automatic']);
    expect((await readdir(statePaths.directory)).filter((name) => name.startsWith('state.lock'))).toEqual([]);
  });
  test('preserves displaced malformed legacy reclaim bytes while recovering automatically', async () => {
    const statePaths = await paths();
    const claim = `${statePaths.lockFile}.reclaim`;
    await writeFile(claim, 'legacy-reclaim-token', { mode: 0o600 });
    await ageLockArtifacts(statePaths.directory);

    const recovered = await mutateState(statePaths, (current) => ({ ...current, knownIds: ['legacy-claim-recovered'] }));
    const orphan = (await readdir(statePaths.directory)).find((entry) => /^state\.lock\.reclaim\.orphan-[0-9a-f-]{36}$/i.test(entry));

    expect(recovered.knownIds).toEqual(['legacy-claim-recovered']);
    expect(orphan).toBeDefined();
    expect(await readFile(join(statePaths.directory, orphan!), 'utf8')).toBe('legacy-reclaim-token');
  });
  test('does not remove a replacement lock owned by another token', async () => {
    const statePaths = await paths(); let replace!: () => void; let finish!: () => void; const ready = new Promise<void>((resolve) => { replace = resolve; }); const allowed = new Promise<void>((resolve) => { finish = resolve; });
    const mutation = mutateState(statePaths, (async (current: RaccoonState) => { replace(); await allowed; return current; }) as unknown as (current: RaccoonState) => RaccoonState); await ready; await writeFile(statePaths.lockFile, lockRecord(process.pid, new Date().toISOString(), 'replacement-token'), { mode: 0o600 }); finish(); await mutation;
    expect(JSON.parse(await readFile(statePaths.lockFile, 'utf8')).token).toBe('replacement-token'); await unlink(statePaths.lockFile);
  });
  test('does not follow a lock symlink or alter its target', async () => {
    const statePaths = await paths();
    const target = join(statePaths.directory, 'unrelated-lock-target');
    await writeFile(target, 'outside-lock-content', { mode: 0o644 });
    await symlink(target, statePaths.lockFile);

    await expect(mutateState(statePaths, (current) => current)).rejects.toBeInstanceOf(StateStoreError);

    expect(await readFile(target, 'utf8')).toBe('outside-lock-content');
    expect((await stat(target)).mode & 0o777).toBe(0o644);
    expect((await lstat(statePaths.lockFile)).isSymbolicLink()).toBe(true);
  });
});
